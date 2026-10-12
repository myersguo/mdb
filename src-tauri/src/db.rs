use mysql_async::{
    Conn, OptsBuilder, QueryResult, SslOpts, Value,
    prelude::{Protocol, Queryable},
};
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tokio::{sync::Mutex, time::timeout};

pub(super) const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
// ponytail: Bound the v0.1 IPC payload; add streaming when full-result export is required.
pub(super) const MAX_ROWS: usize = 1_000;
pub(super) const MAX_BYTES: usize = 4 * 1024 * 1024;
pub(super) const MAX_SETS: usize = 20;
pub(super) const PAGE_SIZE: u64 = 100;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
    pub tls: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidIdentifier,
    InvalidConnection,
    ConnectTimeout,
    CloseTimeout,
    DisconnectTimeout,
    InvalidSql,
    SessionExpired,
    QueryTimeout,
    PartialExecution,
    CredentialAccess,
    InvalidSqliteFile,
    SqliteTimeout,
    DatabaseTaskFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbError {
    pub message: String,
    pub code: Option<ErrorCode>,
    pub session_lost: bool,
    pub outcome_unknown: bool,
}

impl DbError {
    pub(super) fn input(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
            session_lost: false,
            outcome_unknown: false,
        }
    }

    pub(super) fn coded(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code: Some(code),
            ..Self::input(message)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub session_id: String,
    pub version: String,
    pub database: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultSet {
    pub columns: Vec<Column>,
    // Strings preserve BIGINT/DECIMAL precision; positional rows preserve duplicate column names.
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: String,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponse {
    pub sets: Vec<ResultSet>,
    pub elapsed_ms: u128,
    pub database: Option<String>,
    pub sets_truncated: bool,
    pub has_more: bool,
}

struct Session {
    id: String,
    conn: Conn,
}

#[derive(Default)]
pub struct Database {
    // ponytail: v0.1 has one active session; separate sessions when concurrent connections are required.
    session: Mutex<Option<Session>>,
    next_id: AtomicU64,
}

pub fn quote_identifier(name: &str) -> Result<String, DbError> {
    if name.is_empty() || name.contains('\0') {
        return Err(DbError::coded(
            ErrorCode::InvalidIdentifier,
            "Database and table names cannot be empty or contain NUL.",
        ));
    }
    Ok(format!("`{}`", name.replace('`', "``")))
}

fn options(config: ConnectionConfig) -> Result<OptsBuilder, DbError> {
    if config.host.trim().is_empty() || config.username.trim().is_empty() || config.port == 0 {
        return Err(DbError::coded(
            ErrorCode::InvalidConnection,
            "Enter a host, username and valid port.",
        ));
    }
    let database = config.database.filter(|s| !s.is_empty());
    Ok(OptsBuilder::default()
        .ip_or_hostname(config.host.trim())
        .tcp_port(config.port)
        .user(Some(config.username))
        .pass(Some(config.password))
        .db_name(database)
        .prefer_socket(false)
        .ssl_opts(config.tls.then(SslOpts::default)))
}

async fn open_connection(
    config: ConnectionConfig,
) -> Result<(Conn, String, Option<String>), DbError> {
    let opts = options(config)?;
    match timeout(Duration::from_secs(10), async {
        let mut conn = Conn::new(opts).await?;
        conn.query_drop("SET NAMES utf8mb4").await?;
        let (version, database): (String, Option<String>) = conn
            .query_first("SELECT VERSION(), DATABASE()")
            .await?
            .unwrap();
        Ok::<_, mysql_async::Error>((conn, version, database))
    })
    .await
    {
        Ok(Ok(info)) => Ok(info),
        Ok(Err(error)) => Err(DbError::input(error.to_string())),
        Err(_) => Err(DbError::coded(
            ErrorCode::ConnectTimeout,
            "Connection timed out after 10 seconds. Check the host, port and network.",
        )),
    }
}

impl Database {
    pub async fn connect(&self, config: ConnectionConfig) -> Result<ConnectionInfo, DbError> {
        let mut session = self.session.lock().await;
        let (conn, version, database) = open_connection(config).await?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        *session = Some(Session {
            id: id.clone(),
            conn,
        });
        Ok(ConnectionInfo {
            session_id: id,
            version,
            database,
        })
    }

    pub async fn test_connection(config: ConnectionConfig) -> Result<String, DbError> {
        let (conn, version, _) = open_connection(config).await?;
        timeout(Duration::from_secs(2), conn.disconnect())
            .await
            .map_err(|_| {
                DbError::coded(
                    ErrorCode::CloseTimeout,
                    "Connection test succeeded, but closing the connection timed out.",
                )
            })?
            .map_err(|error| DbError::input(error.to_string()))?;
        Ok(version)
    }

    pub async fn disconnect(&self, id: &str) -> Result<(), DbError> {
        let mut session = self.session.lock().await;
        if session.as_ref().is_some_and(|s| s.id == id) {
            let conn = session.take().unwrap().conn;
            timeout(Duration::from_secs(2), conn.disconnect())
                .await
                .map_err(|_| DbError {
                    message: "Local session closed; the server did not confirm in time.".into(),
                    code: Some(ErrorCode::DisconnectTimeout),
                    session_lost: true,
                    outcome_unknown: false,
                })?
                .map_err(|error| DbError {
                    message: error.to_string(),
                    code: None,
                    session_lost: true,
                    outcome_unknown: false,
                })?;
        }
        Ok(())
    }

    pub async fn execute(
        &self,
        id: &str,
        database: Option<&str>,
        sql: &str,
        params: Vec<Value>,
    ) -> Result<QueryResponse, DbError> {
        self.run(id, database, sql, params, false).await
    }

    pub async fn browse_table(
        &self,
        id: &str,
        database: &str,
        table: &str,
        page: u32,
    ) -> Result<QueryResponse, DbError> {
        let qualified = format!(
            "{}.{}",
            quote_identifier(database)?,
            quote_identifier(table)?
        );
        self.run(
            id,
            Some(database),
            &qualified,
            vec![
                database.into(),
                table.into(),
                (u64::from(page) * PAGE_SIZE).into(),
            ],
            true,
        )
        .await
    }

    async fn run(
        &self,
        id: &str,
        database: Option<&str>,
        sql: &str,
        params: Vec<Value>,
        browse: bool,
    ) -> Result<QueryResponse, DbError> {
        if sql.trim().is_empty() || sql.len() > 1024 * 1024 {
            return Err(DbError::coded(
                ErrorCode::InvalidSql,
                "SQL must not be empty or exceed 1 MiB.",
            ));
        }
        let quoted_db = database
            .filter(|s| !s.is_empty())
            .map(quote_identifier)
            .transpose()?;
        let mut guard = self.session.lock().await;
        let session = guard
            .as_mut()
            .filter(|s| s.id == id)
            .ok_or_else(|| DbError {
                message: "Connection expired. Reconnect to continue.".into(),
                code: Some(ErrorCode::SessionExpired),
                session_lost: true,
                outcome_unknown: false,
            })?;
        let started = Instant::now();
        let mut partial_execution = false;
        let operation = async {
            if let Some(name) = quoted_db {
                session.conn.query_drop(format!("USE {name}")).await?;
            }
            let mut response = if browse {
                let keys: Vec<String> = session.conn.exec(
                    "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX",
                    (params[0].clone(), params[1].clone()),
                ).await?;
                let order = if keys.is_empty() {
                    String::new()
                } else {
                    format!(
                        " ORDER BY {}",
                        keys.iter()
                            .map(|k| format!("`{}`", k.replace('`', "``")))
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                };
                let query = format!("SELECT * FROM {sql}{order} LIMIT 101 OFFSET ?");
                collect(
                    &mut session.conn,
                    &query,
                    vec![params[2].clone()],
                    &mut partial_execution,
                )
                .await?
            } else {
                collect(&mut session.conn, sql, params, &mut partial_execution).await?
            };
            if browse && let Some(set) = response.sets.first_mut() {
                response.has_more = set.rows.len() > PAGE_SIZE as usize;
                set.rows.truncate(PAGE_SIZE as usize);
            }
            response.database = session
                .conn
                .query_first::<Option<String>, _>("SELECT DATABASE()")
                .await?
                .flatten();
            response.elapsed_ms = started.elapsed().as_millis();
            Ok::<_, mysql_async::Error>(response)
        };
        match timeout(QUERY_TIMEOUT, operation).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(error)) => {
                let session_lost = error.is_fatal();
                if session_lost {
                    guard.take();
                }
                Err(DbError {
                    message: error.to_string(),
                    code: partial_execution.then_some(ErrorCode::PartialExecution),
                    session_lost,
                    outcome_unknown: session_lost || partial_execution,
                })
            }
            Err(_) => {
                // Discard a timed-out protocol stream rather than reusing an indeterminate session.
                guard.take();
                Err(DbError {
                    message: "Query exceeded 30 seconds and the connection was closed. The server may still be running it; writes may have taken effect. Verify the outcome before acting again.".into(),
                    code: Some(ErrorCode::QueryTimeout),
                    session_lost: true,
                    outcome_unknown: true,
                })
            }
        }
    }
}

async fn collect(
    conn: &mut Conn,
    sql: &str,
    params: Vec<Value>,
    partial_execution: &mut bool,
) -> mysql_async::Result<QueryResponse> {
    if params.is_empty() {
        // A procedure can commit writes and then fail before returning its first result.
        let result = conn
            .query_iter(sql)
            .await
            .inspect_err(|_| *partial_execution = true)?;
        collect_result(result, partial_execution).await
    } else {
        let result = conn
            .exec_iter(sql, params)
            .await
            .inspect_err(|_| *partial_execution = true)?;
        collect_result(result, partial_execution).await
    }
}

async fn collect_result<P: Protocol>(
    mut result: QueryResult<'_, '_, P>,
    partial_execution: &mut bool,
) -> mysql_async::Result<QueryResponse> {
    let mut sets = Vec::new();
    let mut bytes = 0;
    let mut row_count = 0;
    let mut sets_truncated = false;
    loop {
        if sets.len() >= MAX_SETS {
            sets_truncated = true;
            break;
        }
        let mysql_columns = result.columns_ref().to_vec();
        let columns = mysql_columns
            .iter()
            .map(|c| Column {
                name: c.name_str().into_owned(),
                data_type: format!("{:?}", c.column_type())
                    .trim_start_matches("MYSQL_TYPE_")
                    .into(),
            })
            .collect();
        let mut set = ResultSet {
            columns,
            rows: Vec::new(),
            affected_rows: result.affected_rows().to_string(),
            truncated: false,
        };
        result
            .for_each(|row| {
                if row_count >= MAX_ROWS || bytes >= MAX_BYTES {
                    set.truncated = true;
                    return;
                }
                let cells: Vec<Option<String>> = row
                    .unwrap()
                    .into_iter()
                    .zip(&mysql_columns)
                    .map(|(v, c)| cell(v, c.character_set() == 63, c.column_type()))
                    .collect();
                let size = cells.iter().flatten().map(String::len).sum::<usize>();
                if bytes + size > MAX_BYTES {
                    set.truncated = true;
                    bytes = MAX_BYTES;
                    return;
                }
                bytes += size;
                row_count += 1;
                set.rows.push(cells);
            })
            .await
            .inspect_err(|_| *partial_execution = true)?;
        sets.push(set);
        if result.is_empty() {
            break;
        }
    }
    result
        .drop_result()
        .await
        .inspect_err(|_| *partial_execution = true)?;
    Ok(QueryResponse {
        sets,
        elapsed_ms: 0,
        database: None,
        sets_truncated,
        has_more: false,
    })
}

fn cell(value: Value, binary: bool, data_type: mysql_async::consts::ColumnType) -> Option<String> {
    use mysql_async::consts::ColumnType::*;
    Some(match value {
        Value::NULL => return None,
        Value::Bytes(bytes) => {
            if binary
                && matches!(
                    data_type,
                    MYSQL_TYPE_STRING
                        | MYSQL_TYPE_VAR_STRING
                        | MYSQL_TYPE_VARCHAR
                        | MYSQL_TYPE_BLOB
                        | MYSQL_TYPE_LONG_BLOB
                        | MYSQL_TYPE_MEDIUM_BLOB
                        | MYSQL_TYPE_TINY_BLOB
                        | MYSQL_TYPE_BIT
                        | MYSQL_TYPE_GEOMETRY
                )
            {
                hex(&bytes)
            } else {
                String::from_utf8(bytes).unwrap_or_else(|error| hex(error.as_bytes()))
            }
        }
        Value::Int(value) => value.to_string(),
        Value::UInt(value) => value.to_string(),
        Value::Float(value) => value.to_string(),
        Value::Double(value) => value.to_string(),
        Value::Date(year, month, day, hour, minute, second, micros) => {
            let date = format!("{year:04}-{month:02}-{day:02}");
            if matches!(data_type, MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE) {
                date
            } else {
                format!(
                    "{date} {hour:02}:{minute:02}:{second:02}{}",
                    fraction(micros)
                )
            }
        }
        Value::Time(negative, days, hours, minutes, seconds, micros) => format!(
            "{}{:02}:{minutes:02}:{seconds:02}{}",
            if negative { "-" } else { "" },
            days * 24 + u32::from(hours),
            fraction(micros)
        ),
    })
}

fn fraction(micros: u32) -> String {
    if micros == 0 {
        String::new()
    } else {
        format!(".{micros:06}")
    }
}

pub(super) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut output = String::from("0x");
    for byte in bytes {
        write!(output, "{byte:02X}").unwrap();
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use mysql_async::consts::ColumnType::*;

    #[test]
    fn identifiers_escape_backticks_and_reject_nul() {
        assert_eq!(
            quote_identifier("demo`; DROP TABLE users; --").unwrap(),
            "`demo``; DROP TABLE users; --`"
        );
        assert!(quote_identifier("").is_err());
        assert!(quote_identifier("a\0b").is_err());
    }

    #[test]
    fn cells_preserve_precision_null_binary_and_temporal_values() {
        assert_eq!(
            cell(Value::UInt(u64::MAX), false, MYSQL_TYPE_LONGLONG),
            Some("18446744073709551615".into())
        );
        assert_eq!(
            cell(
                Value::Bytes(b"9999999999999999.123456".to_vec()),
                true,
                MYSQL_TYPE_NEWDECIMAL
            ),
            Some("9999999999999999.123456".into())
        );
        assert_eq!(cell(Value::NULL, false, MYSQL_TYPE_NULL), None);
        assert_eq!(
            cell(Value::Bytes(b"hello".to_vec()), true, MYSQL_TYPE_BLOB),
            Some("0x68656C6C6F".into())
        );
        assert_eq!(
            cell(Value::Bytes(vec![0xFF]), false, MYSQL_TYPE_STRING),
            Some("0xFF".into())
        );
        assert_eq!(
            cell(
                Value::Date(2026, 10, 12, 0, 0, 0, 0),
                false,
                MYSQL_TYPE_DATE
            ),
            Some("2026-10-12".into())
        );
        assert_eq!(
            cell(
                Value::Date(2026, 10, 12, 0, 0, 0, 123456),
                false,
                MYSQL_TYPE_DATETIME
            ),
            Some("2026-10-12 00:00:00.123456".into())
        );
        assert_eq!(
            cell(Value::Time(true, 2, 1, 2, 3, 100), false, MYSQL_TYPE_TIME),
            Some("-49:02:03.000100".into())
        );
    }

    fn config(port: u16) -> ConnectionConfig {
        ConnectionConfig {
            host: "127.0.0.1".into(),
            port,
            username: "root".into(),
            password: String::new(),
            database: None,
            tls: false,
        }
    }

    #[test]
    fn connection_options_validate_and_do_not_parse_credentials_as_a_url() {
        assert!(options(config(0)).is_err());
        let mut cfg = config(3306);
        cfg.password = "a@b:/?#%".into();
        let opts: mysql_async::Opts = options(cfg).unwrap().into();
        assert_eq!(opts.pass(), Some("a@b:/?#%"));
        assert!(!opts.prefer_socket());
    }

    #[tokio::test]
    async fn invalid_session_cannot_query() {
        let db = Database::default();
        let error = db
            .execute("old", None, "SELECT 1", vec![])
            .await
            .unwrap_err();
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["code"], "session_expired");
        assert_eq!(serialized["sessionLost"], true);
        assert_eq!(serialized["outcomeUnknown"], false);
        let error = db.execute("old", None, " ", vec![]).await.unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap()["code"], "invalid_sql");
    }

    #[test]
    fn error_codes_serialize_separately_from_raw_driver_messages() {
        let error = quote_identifier("").unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "invalid_identifier"
        );
        let error = options(config(0)).unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "invalid_connection"
        );
        let raw = "Unknown column '字段'";
        let serialized = serde_json::to_value(DbError::input(raw)).unwrap();
        assert_eq!(serialized["message"], raw);
        assert!(serialized["code"].is_null());
    }

    #[tokio::test]
    #[ignore = "Requires isolated MySQL: run npm run test:mysql"]
    async fn mysql_integration() {
        let port = std::env::var("MDB_TEST_MYSQL_PORT")
            .expect("MDB_TEST_MYSQL_PORT")
            .parse()
            .unwrap();
        let db = Database::default();
        let info = db.connect(config(port)).await.unwrap();
        let id = info.session_id;
        db.execute(
            &id,
            None,
            "SELECT VERSION() AS version, CURRENT_USER() AS user_name, DATABASE() AS database_name",
            vec![],
        )
        .await
        .unwrap();
        db.execute(&id, None, "CREATE DATABASE mdb_test", vec![])
            .await
            .unwrap();
        db.execute(&id, Some("mdb_test"), "CREATE TABLE `odd``table` (id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(30,6), payload BLOB, empty_value VARCHAR(10), date_value DATETIME(6))", vec![]).await.unwrap();
        let insert = db.execute(&id, Some("mdb_test"), "INSERT INTO `odd``table` VALUES (18446744073709551615, 9999999999999999.123456, X'00FF61', NULL, '2026-10-12 00:00:00.123456')", vec![]).await.unwrap();
        assert_eq!(insert.sets[0].affected_rows, "1");
        let response = db
            .browse_table(&id, "mdb_test", "odd`table", 0)
            .await
            .unwrap();
        assert_eq!(
            response.sets[0].rows[0],
            vec![
                Some("18446744073709551615".into()),
                Some("9999999999999999.123456".into()),
                Some("0x00FF61".into()),
                None,
                Some("2026-10-12 00:00:00.123456".into())
            ]
        );
        let result = db
            .execute(&id, None, "SELECT 1 AS same, 2 AS same WHERE FALSE", vec![])
            .await
            .unwrap();
        assert_eq!(result.sets[0].columns.len(), 2);
        assert!(result.sets[0].rows.is_empty());
        db.execute(
            &id,
            Some("mdb_test"),
            "CREATE PROCEDURE multi_result() BEGIN SELECT 1 AS first; SELECT 2 AS second; END",
            vec![],
        )
        .await
        .unwrap();
        let multiple = db
            .execute(&id, Some("mdb_test"), "CALL multi_result()", vec![])
            .await
            .unwrap();
        assert_eq!(multiple.sets[0].rows[0][0], Some("1".into()));
        assert_eq!(multiple.sets[1].rows[0][0], Some("2".into()));
        let batch = db
            .execute(&id, None, "SELECT 1; SELECT 2", vec![])
            .await
            .unwrap();
        assert_eq!(batch.sets[0].rows[0][0], Some("1".into()));
        assert_eq!(batch.sets[1].rows[0][0], Some("2".into()));
        db.execute(
            &id,
            Some("mdb_test"),
            "CREATE TABLE partial_writes (id INT PRIMARY KEY)",
            vec![],
        )
        .await
        .unwrap();
        db.execute(&id, Some("mdb_test"), "CREATE PROCEDURE failed_write() BEGIN INSERT INTO partial_writes VALUES(99); SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic procedure failure'; END", vec![]).await.unwrap();
        let failure = db
            .execute(&id, Some("mdb_test"), "CALL failed_write()", vec![])
            .await
            .unwrap_err();
        assert!(failure.outcome_unknown && !failure.session_lost);
        assert!(matches!(failure.code, Some(ErrorCode::PartialExecution)));
        let persisted = db
            .execute(
                &id,
                Some("mdb_test"),
                "SELECT id FROM partial_writes",
                vec![],
            )
            .await
            .unwrap();
        assert_eq!(persisted.sets[0].rows, vec![vec![Some("99".into())]]);
        db.execute(
            &id,
            Some("mdb_test"),
            "DELETE FROM partial_writes WHERE id = 99",
            vec![],
        )
        .await
        .unwrap();
        let partial = db.execute(&id, Some("mdb_test"), "INSERT INTO partial_writes VALUES (1); SELECT missing_column; INSERT INTO partial_writes VALUES (2)", vec![]).await.unwrap_err();
        assert!(partial.outcome_unknown && !partial.session_lost);
        assert_eq!(
            serde_json::to_value(&partial).unwrap()["code"],
            "partial_execution"
        );
        assert!(partial.message.contains("missing_column"));
        let persisted = db
            .execute(
                &id,
                Some("mdb_test"),
                "SELECT id FROM partial_writes",
                vec![],
            )
            .await
            .unwrap();
        assert_eq!(persisted.sets[0].rows, vec![vec![Some("1".into())]]);
        assert!(
            db.execute(&id, None, "SELECT missing_column", vec![])
                .await
                .is_err()
        );
        assert_eq!(
            db.execute(&id, None, "SELECT 1", vec![])
                .await
                .unwrap()
                .sets[0]
                .rows[0][0],
            Some("1".into())
        );
        let truncated = db.execute(&id, None, "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 32) SELECT a.n, b.n FROM seq a CROSS JOIN seq b LIMIT 1001", vec![]).await.unwrap();
        assert_eq!(truncated.sets[0].rows.len(), MAX_ROWS);
        assert!(truncated.sets[0].truncated);
        let bytes = db
            .execute(&id, None, "SELECT REPEAT('x', 4194305)", vec![])
            .await
            .unwrap();
        assert!(bytes.sets[0].truncated);
        assert!(bytes.sets[0].rows.is_empty());
        db.execute(
            &id,
            Some("mdb_test"),
            "CREATE TABLE pages (id INT PRIMARY KEY)",
            vec![],
        )
        .await
        .unwrap();
        db.execute(&id, Some("mdb_test"), "INSERT INTO pages WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 101) SELECT n FROM seq", vec![]).await.unwrap();
        assert!(
            db.browse_table(&id, "mdb_test", "pages", 0)
                .await
                .unwrap()
                .has_more
        );
        let page2 = db.browse_table(&id, "mdb_test", "pages", 1).await.unwrap();
        assert_eq!(page2.sets[0].rows[0][0], Some("101".into()));
        assert!(!page2.has_more);
        let second = db.connect(config(port)).await.unwrap();
        let mut invalid = config(port);
        invalid.username = "missing_account".into();
        assert!(db.connect(invalid).await.is_err());
        assert!(
            db.execute(&id, None, "SELECT 1", vec![])
                .await
                .unwrap_err()
                .session_lost
        );
        db.disconnect(&id).await.unwrap();
        db.execute(&second.session_id, None, "SELECT 1", vec![])
            .await
            .unwrap();
        let timed_out = db
            .execute(&second.session_id, None, "SELECT SLEEP(31)", vec![])
            .await
            .unwrap_err();
        assert!(timed_out.session_lost && timed_out.outcome_unknown);
        assert_eq!(
            serde_json::to_value(&timed_out).unwrap()["code"],
            "query_timeout"
        );
        db.disconnect(&second.session_id).await.unwrap();
        assert!(
            db.execute(&second.session_id, None, "SELECT 1", vec![])
                .await
                .unwrap_err()
                .session_lost
        );
    }
}
