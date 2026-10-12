use crate::connections::Operation;
use crate::db::{
    Column, DbError, ErrorCode, MAX_BYTES, MAX_ROWS, MAX_SETS, PAGE_SIZE, QUERY_TIMEOUT,
    QueryResponse, ResultSet, hex, quote_identifier,
};
use rusqlite::{
    Batch, Connection, OpenFlags, Statement,
    fallible_iterator::FallibleIterator,
    types::{Value, ValueRef},
};
use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};

pub struct Database {
    conn: Mutex<Connection>,
}

pub fn file_error() -> DbError {
    DbError::coded(
        ErrorCode::InvalidSqliteFile,
        "Choose an existing SQLite database file using an absolute path.",
    )
}

pub fn task_error() -> DbError {
    DbError {
        message: "Database worker failed; reconnect before continuing.".into(),
        code: Some(ErrorCode::DatabaseTaskFailed),
        session_lost: true,
        outcome_unknown: true,
    }
}

impl Database {
    pub fn open(path: &str) -> Result<Self, DbError> {
        let path = Path::new(path);
        if !path.is_absolute() || !path.is_file() {
            return Err(file_error());
        }
        // Opening an existing file must not silently create a new database on a mistyped path.
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| DbError::input(error.to_string()))?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(|error| DbError::input(error.to_string()))?;
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(|error| DbError::input(error.to_string()))?;
        conn.query_row("PRAGMA schema_version", [], |row| row.get::<_, i64>(0))
            .map_err(|error| DbError::input(error.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn perform(&self, operation: Operation) -> Result<QueryResponse, DbError> {
        let conn = self.conn.lock().map_err(|_| task_error())?;
        let (sql, params, database, browse) = match operation {
            Operation::Execute { sql, database } => (sql, vec![], database, false),
            Operation::ListDatabases => (
                "SELECT name AS Database FROM pragma_database_list ORDER BY seq".into(),
                vec![],
                None,
                false,
            ),
            Operation::ListTables { database } => {
                let quoted = quote_identifier(&database)?;
                (
                    format!(
                        "SELECT name, CASE type WHEN 'table' THEN 'BASE TABLE' ELSE 'VIEW' END AS kind, 'SQLite' AS engine, NULL AS rows, NULL AS comment FROM {quoted}.sqlite_schema WHERE type IN ('table','view') AND name NOT GLOB 'sqlite_*' ORDER BY name"
                    ),
                    vec![],
                    Some(database),
                    false,
                )
            }
            Operation::Structure { database, table } => {
                quote_identifier(&database)?;
                quote_identifier(&table)?;
                ("SELECT cid, name, type, [notnull], dflt_value, pk, hidden FROM pragma_table_xinfo(?, ?) ORDER BY cid".into(), vec![table.into(), database.clone().into()], Some(database), false)
            }
            Operation::Browse {
                database,
                table,
                page,
            } => {
                let qualified = format!(
                    "{}.{}",
                    quote_identifier(&database)?,
                    quote_identifier(&table)?
                );
                let mut statement = conn
                    .prepare("SELECT name FROM pragma_table_xinfo(?, ?) WHERE pk > 0 ORDER BY pk")
                    .map_err(|error| DbError::input(error.to_string()))?;
                let keys = statement
                    .query_map([&table, &database], |row| row.get::<_, String>(0))
                    .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
                    .map_err(|error| DbError::input(error.to_string()))?;
                let order = if keys.is_empty() {
                    String::new()
                } else {
                    format!(
                        " ORDER BY {}",
                        keys.iter()
                            .map(|name| quote_identifier(name))
                            .collect::<Result<Vec<_>, _>>()?
                            .join(", ")
                    )
                };
                (
                    format!("SELECT * FROM {qualified}{order} LIMIT 101 OFFSET ?"),
                    vec![Value::Integer(i64::from(page) * PAGE_SIZE as i64)],
                    Some(database),
                    true,
                )
            }
        };
        let mut response = execute(&conn, &sql, params, database.as_deref(), QUERY_TIMEOUT)?;
        if browse && let Some(set) = response.sets.first_mut() {
            response.has_more = set.rows.len() > PAGE_SIZE as usize;
            set.rows.truncate(PAGE_SIZE as usize);
        }
        Ok(response)
    }
}

#[derive(Default)]
struct Budget {
    rows: usize,
    bytes: usize,
}

fn collect(
    conn: &Connection,
    statement: &mut Statement<'_>,
    budget: &mut Budget,
) -> rusqlite::Result<ResultSet> {
    let columns: Vec<_> = statement
        .columns()
        .into_iter()
        .map(|column| Column {
            name: column.name().into(),
            data_type: column.decl_type().unwrap_or("ANY").into(),
        })
        .collect();
    let before = conn.total_changes();
    let mut set = ResultSet {
        columns,
        rows: vec![],
        affected_rows: "0".into(),
        truncated: false,
    };
    {
        let mut rows = statement.raw_query();
        while let Some(row) = rows.next()? {
            if budget.rows >= MAX_ROWS || budget.bytes >= MAX_BYTES {
                set.truncated = true;
                continue;
            }
            let mut cells = Vec::with_capacity(set.columns.len());
            let mut size = 0;
            for index in 0..set.columns.len() {
                let value = row.get_ref(index)?;
                let length = match value {
                    ValueRef::Blob(bytes) => bytes.len().saturating_mul(2).saturating_add(2),
                    ValueRef::Text(bytes) if std::str::from_utf8(bytes).is_err() => {
                        bytes.len().saturating_mul(2).saturating_add(2)
                    }
                    ValueRef::Text(bytes) => bytes.len(),
                    _ => 0,
                };
                if length > MAX_BYTES - budget.bytes - size {
                    set.truncated = true;
                    budget.bytes = MAX_BYTES;
                    break;
                }
                let cell = match value {
                    ValueRef::Null => None,
                    ValueRef::Integer(value) => Some(value.to_string()),
                    ValueRef::Real(value) => Some(value.to_string()),
                    ValueRef::Text(bytes) => {
                        Some(std::str::from_utf8(bytes).map_or_else(|_| hex(bytes), str::to_owned))
                    }
                    ValueRef::Blob(bytes) => Some(hex(bytes)),
                };
                size += cell.as_ref().map_or(0, String::len);
                if size > MAX_BYTES - budget.bytes {
                    set.truncated = true;
                    budget.bytes = MAX_BYTES;
                    break;
                }
                cells.push(cell);
            }
            if cells.len() == set.columns.len() {
                budget.bytes += size;
                budget.rows += 1;
                set.rows.push(cells);
            }
        }
    }
    if conn.total_changes() > before {
        set.affected_rows = conn.changes().to_string();
    }
    Ok(set)
}

fn execute(
    conn: &Connection,
    sql: &str,
    params: Vec<Value>,
    database: Option<&str>,
    duration: Duration,
) -> Result<QueryResponse, DbError> {
    if sql.trim().is_empty() || sql.len() > 1024 * 1024 {
        return Err(DbError::coded(
            ErrorCode::InvalidSql,
            "SQL must not be empty or exceed 1 MiB.",
        ));
    }
    let started = Instant::now();
    let deadline = started + duration;
    // ponytail: VM instructions and lock waits are bounded; filesystem calls rely on the OS.
    conn.progress_handler(1000, Some(move || Instant::now() >= deadline))
        .map_err(|error| DbError::input(error.to_string()))?;
    let initial_changes = conn.total_changes();
    let mut completed = 0;
    let operation = (|| {
        let mut sets = vec![];
        let mut budget = Budget::default();
        let mut sets_truncated = false;
        let mut batch = Batch::new(conn, sql);
        while let Some(mut statement) = batch.next()? {
            if Instant::now() >= deadline {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_INTERRUPT),
                    None,
                ));
            }
            for (index, value) in params.iter().enumerate() {
                statement.raw_bind_parameter(index + 1, value)?;
            }
            if sets.len() >= MAX_SETS {
                sets_truncated = true;
                budget.rows = MAX_ROWS;
            }
            let result = collect(conn, &mut statement, &mut budget)?;
            completed += 1;
            if sets.len() < MAX_SETS {
                sets.push(result);
            }
        }
        let selected = conn
            .query_row(
                "SELECT name FROM pragma_database_list WHERE name = ?",
                [database.unwrap_or("main")],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| "main".into());
        if sets.is_empty() {
            sets.push(ResultSet {
                columns: vec![],
                rows: vec![],
                affected_rows: "0".into(),
                truncated: false,
            });
        }
        Ok(QueryResponse {
            sets,
            elapsed_ms: started.elapsed().as_millis(),
            database: Some(selected),
            sets_truncated,
            has_more: false,
        })
    })();
    conn.progress_handler(0, None::<fn() -> bool>)
        .map_err(|error| DbError::input(error.to_string()))?;
    operation.map_err(|error: rusqlite::Error| {
        let timed_out = matches!(error, rusqlite::Error::SqliteFailure(ref code, _) if code.code == rusqlite::ErrorCode::OperationInterrupted);
        DbError {
            message: error.to_string(),
            code: if timed_out { Some(ErrorCode::SqliteTimeout) } else if completed > 0 || conn.total_changes() > initial_changes { Some(ErrorCode::PartialExecution) } else { None },
            session_lost: timed_out,
            outcome_unknown: timed_out || completed > 0 || conn.total_changes() > initial_changes,
        }
    })
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Database {
        Database {
            conn: Mutex::new(Connection::open_in_memory().unwrap()),
        }
    }
    fn sql(db: &Database, sql: &str) -> QueryResponse {
        db.perform(Operation::Execute {
            database: Some("main".into()),
            sql: sql.into(),
        })
        .unwrap()
    }

    #[test]
    fn values_scripts_triggers_and_empty_headers() {
        let db = memory();
        let result = sql(
            &db,
            "CREATE TABLE items(id INTEGER PRIMARY KEY, amount TEXT, note TEXT, payload BLOB); CREATE TABLE audit(note TEXT); CREATE TRIGGER track AFTER INSERT ON items BEGIN INSERT INTO audit VALUES ('semi;colon'); END; INSERT INTO items VALUES (9223372036854775807, '9999999999999999.123456', NULL, X'00FF'); SELECT * FROM items;",
        );
        assert_eq!(result.sets[3].affected_rows, "1");
        assert_eq!(
            result.sets[4].rows[0],
            vec![
                Some("9223372036854775807".into()),
                Some("9999999999999999.123456".into()),
                None,
                Some("0x00FF".into())
            ]
        );
        assert_eq!(
            sql(&db, "SELECT note FROM audit").sets[0].rows[0][0].as_deref(),
            Some("semi;colon")
        );
        let empty = sql(&db, "SELECT 1 AS same, 2 AS same WHERE FALSE");
        assert_eq!(
            empty.sets[0]
                .columns
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["same", "same"]
        );
        assert!(empty.sets[0].rows.is_empty());
        assert_eq!(
            sql(&db, "SELECT '' AS empty, X'' AS binary").sets[0].rows[0],
            [Some("".into()), Some("0x".into())]
        );
        assert_eq!(
            sql(&db, "SELECT CAST(X'FF' AS TEXT)").sets[0].rows[0][0].as_deref(),
            Some("0xFF")
        );
        let ddl = sql(
            &db,
            "INSERT INTO audit VALUES ('one'); CREATE TABLE other(id INT)",
        );
        assert_eq!(ddl.sets[1].affected_rows, "0");
    }

    #[test]
    fn catalogs_structure_primary_key_pagination_and_quoted_names() {
        let db = memory();
        sql(
            &db,
            "CREATE TABLE `odd``table` (id INTEGER PRIMARY KEY, value TEXT); CREATE VIEW sample AS SELECT * FROM `odd``table`; WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<101) INSERT INTO `odd``table` SELECT n, 'value' FROM seq;",
        );
        let catalog = db
            .perform(Operation::ListTables {
                database: "main".into(),
            })
            .unwrap();
        assert_eq!(catalog.sets[0].rows.len(), 2);
        assert_eq!(catalog.sets[0].rows[1][1].as_deref(), Some("VIEW"));
        let structure = db
            .perform(Operation::Structure {
                database: "main".into(),
                table: "odd`table".into(),
            })
            .unwrap();
        assert_eq!(structure.sets[0].rows[0][1].as_deref(), Some("id"));
        let browse = |page| {
            db.perform(Operation::Browse {
                database: "main".into(),
                table: "odd`table".into(),
                page,
            })
            .unwrap()
        };
        assert!(browse(0).has_more);
        assert_eq!(browse(1).sets[0].rows[0][0].as_deref(), Some("101"));
        assert!(!browse(1).has_more);
        assert!(
            db.perform(Operation::ListTables {
                database: "main`; DROP TABLE sample; --".into()
            })
            .is_err()
        );
        assert_eq!(
            db.perform(Operation::ListDatabases).unwrap().sets[0].rows[0][0].as_deref(),
            Some("main")
        );
    }

    #[test]
    fn display_limits_drain_returning_and_execute_later_statements() {
        let db = memory();
        sql(&db, "CREATE TABLE rows(id INTEGER PRIMARY KEY)");
        let result = sql(
            &db,
            "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1001) INSERT INTO rows SELECT n FROM seq RETURNING id; INSERT INTO rows VALUES(1002);",
        );
        assert_eq!(result.sets[0].rows.len(), MAX_ROWS);
        assert!(result.sets[0].truncated);
        assert_eq!(
            sql(&db, "SELECT COUNT(*) FROM rows").sets[0].rows[0][0].as_deref(),
            Some("1002")
        );
        let large = sql(&db, "SELECT zeroblob(4194305)");
        assert!(large.sets[0].truncated && large.sets[0].rows.is_empty());
        let many = sql(
            &db,
            &format!(
                "{}INSERT INTO rows VALUES(1003);",
                "SELECT 1;".repeat(MAX_SETS + 1)
            ),
        );
        assert!(many.sets_truncated);
        assert_eq!(many.sets.len(), MAX_SETS);
        assert_eq!(
            sql(&db, "SELECT MAX(id) FROM rows").sets[0].rows[0][0].as_deref(),
            Some("1003")
        );
    }

    #[test]
    fn partial_errors_and_single_statement_fail_writes_are_reported() {
        let db = memory();
        sql(&db, "CREATE TABLE rows(id INTEGER PRIMARY KEY)");
        let failed = db
            .perform(Operation::Execute {
                database: None,
                sql:
                    "INSERT INTO rows VALUES(1); SELECT missing_column; INSERT INTO rows VALUES(2)"
                        .into(),
            })
            .unwrap_err();
        assert_eq!(
            serde_json::to_value(failed).unwrap()["code"],
            "partial_execution"
        );
        assert_eq!(
            sql(&db, "SELECT COUNT(*) FROM rows").sets[0].rows[0][0].as_deref(),
            Some("1")
        );
        let failed = db
            .perform(Operation::Execute {
                database: None,
                sql: "INSERT OR FAIL INTO rows VALUES(3),(1)".into(),
            })
            .unwrap_err();
        assert!(failed.outcome_unknown && !failed.session_lost);
        assert_eq!(
            sql(&db, "SELECT COUNT(*) FROM rows").sets[0].rows[0][0].as_deref(),
            Some("2")
        );
        assert!(
            db.perform(Operation::Execute {
                database: None,
                sql: "SELECT missing_column".into()
            })
            .unwrap_err()
            .code
            .is_none()
        );
    }

    #[test]
    fn timeout_interrupts_real_sqlite_work() {
        let db = memory();
        let conn = db.conn.lock().unwrap();
        let error = execute(&conn, "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000000000) SELECT SUM(n) FROM seq", vec![], None, Duration::from_millis(5)).unwrap_err();
        assert!(error.session_lost && error.outcome_unknown);
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "sqlite_timeout"
        );
    }

    #[test]
    fn opens_existing_files_persists_writes_and_rejects_missing_or_invalid_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("demo.sqlite");
        Connection::open(&path).unwrap();
        let db = Database::open(path.to_str().unwrap()).unwrap();
        sql(
            &db,
            "CREATE TABLE persisted(id INTEGER); INSERT INTO persisted VALUES(1)",
        );
        sql(
            &db,
            "CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id))",
        );
        assert!(
            db.perform(Operation::Execute {
                database: None,
                sql: "INSERT INTO child VALUES(999)".into()
            })
            .is_err()
        );
        drop(db);
        let db = Database::open(path.to_str().unwrap()).unwrap();
        assert_eq!(
            sql(&db, "SELECT id FROM persisted").sets[0].rows[0][0].as_deref(),
            Some("1")
        );
        let missing = directory.path().join("missing.db");
        assert!(Database::open(missing.to_str().unwrap()).is_err());
        assert!(!missing.exists());
        std::fs::write(directory.path().join("invalid.db"), "not a database").unwrap();
        assert!(Database::open(directory.path().join("invalid.db").to_str().unwrap()).is_err());
        assert!(Database::open(":memory:").is_err());
    }
}
