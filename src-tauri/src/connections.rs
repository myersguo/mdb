use crate::{
    db::{self, ConnectionInfo, DbError, ErrorCode, QueryResponse},
    sqlite,
};
use serde::Deserialize;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use tokio::sync::Mutex;

#[derive(Deserialize)]
#[serde(tag = "engine", rename_all = "lowercase")]
pub enum ConnectionConfig {
    Mysql(db::ConnectionConfig),
    Sqlite { path: String },
}

pub enum Operation {
    Execute {
        database: Option<String>,
        sql: String,
    },
    ListDatabases,
    ListTables {
        database: String,
    },
    Structure {
        database: String,
        table: String,
    },
    Browse {
        database: String,
        table: String,
        page: u32,
    },
}

enum Driver {
    Mysql { db: db::Database, id: String },
    Sqlite(Arc<sqlite::Database>),
}
struct Session {
    id: String,
    driver: Driver,
}
#[derive(Default)]
pub struct Database {
    session: Mutex<Option<Session>>,
    next_id: AtomicU64,
}

impl Database {
    pub async fn connect(&self, config: ConnectionConfig) -> Result<ConnectionInfo, DbError> {
        let mut session = self.session.lock().await;
        let (driver, version, database) = match config {
            ConnectionConfig::Mysql(config) => {
                let db = db::Database::default();
                let info = db.connect(config).await?;
                (
                    Driver::Mysql {
                        db,
                        id: info.session_id,
                    },
                    info.version,
                    info.database,
                )
            }
            ConnectionConfig::Sqlite { path } => {
                let db = tokio::task::spawn_blocking(move || sqlite::Database::open(&path))
                    .await
                    .map_err(|_| sqlite::task_error())??;
                (
                    Driver::Sqlite(Arc::new(db)),
                    rusqlite::version().into(),
                    Some("main".into()),
                )
            }
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        *session = Some(Session {
            id: id.clone(),
            driver,
        });
        Ok(ConnectionInfo {
            session_id: id,
            version,
            database,
        })
    }

    pub async fn test_connection(config: ConnectionConfig) -> Result<String, DbError> {
        match config {
            ConnectionConfig::Mysql(config) => db::Database::test_connection(config).await,
            ConnectionConfig::Sqlite { path } => tokio::task::spawn_blocking(move || {
                sqlite::Database::open(&path).map(|_| rusqlite::version().to_string())
            })
            .await
            .map_err(|_| sqlite::task_error())?,
        }
    }

    pub async fn disconnect(&self, id: &str) -> Result<(), DbError> {
        let mut session = self.session.lock().await;
        if session.as_ref().is_some_and(|s| s.id == id) {
            match session.take().unwrap().driver {
                Driver::Mysql { db, id } => db.disconnect(&id).await?,
                Driver::Sqlite(db) => {
                    tokio::task::spawn_blocking(move || drop(db))
                        .await
                        .map_err(|_| sqlite::task_error())?;
                }
            }
        }
        Ok(())
    }

    pub async fn perform(&self, id: &str, operation: Operation) -> Result<QueryResponse, DbError> {
        let mut guard = self.session.lock().await;
        let session = guard
            .as_ref()
            .filter(|s| s.id == id)
            .ok_or_else(|| DbError {
                message: "Connection expired. Reconnect to continue.".into(),
                code: Some(ErrorCode::SessionExpired),
                session_lost: true,
                outcome_unknown: false,
            })?;
        let response = match &session.driver {
            Driver::Sqlite(db) => {
                let db = Arc::clone(db);
                tokio::task::spawn_blocking(move || db.perform(operation)).await.unwrap_or_else(|_| Err(sqlite::task_error()))
            }
            Driver::Mysql { db, id } => match operation {
                Operation::Execute { database, sql } => db.execute(id, database.as_deref(), &sql, vec![]).await,
                Operation::ListDatabases => db.execute(id, None, "SHOW DATABASES", vec![]).await,
                Operation::ListTables { database } => db.execute(id, Some(&database), "SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", vec![database.clone().into()]).await,
                Operation::Structure { database, table } => db.execute(id, Some(&database), &format!("SHOW FULL COLUMNS FROM {}.{}", db::quote_identifier(&database)?, db::quote_identifier(&table)?), vec![]).await,
                Operation::Browse { database, table, page } => db.browse_table(id, &database, &table, page).await,
            },
        };
        if response.as_ref().is_err_and(|error| error.session_lost) {
            guard.take();
        }
        response
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, String) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.sqlite");
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE items(id INTEGER)")
            .unwrap();
        (directory, path.to_str().unwrap().into())
    }
    async fn execute(db: &Database, id: &str, sql: &str) -> Result<QueryResponse, DbError> {
        db.perform(
            id,
            Operation::Execute {
                database: None,
                sql: sql.into(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn sqlite_session_switch_rejects_stale_ids_and_rolls_back_pending_writes() {
        let (_directory, path) = fixture();
        let db = Database::default();
        let first = db
            .connect(ConnectionConfig::Sqlite { path: path.clone() })
            .await
            .unwrap();
        execute(&db, &first.session_id, "BEGIN; INSERT INTO items VALUES(1)")
            .await
            .unwrap();
        assert!(
            db.connect(ConnectionConfig::Sqlite {
                path: "/missing/database.sqlite".into()
            })
            .await
            .is_err()
        );
        assert_eq!(
            execute(&db, &first.session_id, "SELECT COUNT(*) FROM items")
                .await
                .unwrap()
                .sets[0]
                .rows[0][0]
                .as_deref(),
            Some("1")
        );
        let second = db.connect(ConnectionConfig::Sqlite { path }).await.unwrap();
        assert_ne!(first.session_id, second.session_id);
        assert!(
            execute(&db, &first.session_id, "SELECT 1")
                .await
                .unwrap_err()
                .session_lost
        );
        db.disconnect(&first.session_id).await.unwrap();
        assert_eq!(
            execute(&db, &second.session_id, "SELECT COUNT(*) FROM items")
                .await
                .unwrap()
                .sets[0]
                .rows[0][0]
                .as_deref(),
            Some("0")
        );
        db.disconnect(&second.session_id).await.unwrap();
        assert!(execute(&db, &second.session_id, "SELECT 1").await.is_err());
    }

    #[test]
    fn config_requires_a_known_engine_and_its_fields() {
        let mysql = serde_json::from_str::<ConnectionConfig>(r#"{"engine":"mysql","host":"localhost","port":3306,"username":"root","password":"","database":"","tls":true}"#).unwrap();
        assert!(matches!(mysql, ConnectionConfig::Mysql(config) if config.host == "localhost"));
        assert!(
            serde_json::from_str::<ConnectionConfig>(
                r#"{"engine":"sqlite","path":"/tmp/data.sqlite"}"#
            )
            .is_ok()
        );
        for value in [
            r#"{"engine":"sqlite"}"#,
            r#"{"engine":"unknown","path":"/tmp/data.sqlite"}"#,
        ] {
            assert!(serde_json::from_str::<ConnectionConfig>(value).is_err());
        }
    }

    #[tokio::test]
    #[ignore = "Requires isolated MySQL: run npm run test:mysql"]
    async fn mysql_integration_switching() {
        let port = std::env::var("MDB_TEST_MYSQL_PORT")
            .unwrap()
            .parse()
            .unwrap();
        let mysql = || {
            ConnectionConfig::Mysql(db::ConnectionConfig {
                host: "127.0.0.1".into(),
                port,
                username: "root".into(),
                password: String::new(),
                database: None,
                tls: false,
            })
        };
        let (_directory, path) = fixture();
        let db = Database::default();
        let first = db.connect(mysql()).await.unwrap();
        assert_eq!(
            execute(&db, &first.session_id, "SELECT 42")
                .await
                .unwrap()
                .sets[0]
                .rows[0][0]
                .as_deref(),
            Some("42")
        );
        db.perform(&first.session_id, Operation::ListDatabases)
            .await
            .unwrap();
        db.perform(
            &first.session_id,
            Operation::ListTables {
                database: "information_schema".into(),
            },
        )
        .await
        .unwrap();
        db.perform(
            &first.session_id,
            Operation::Structure {
                database: "information_schema".into(),
                table: "TABLES".into(),
            },
        )
        .await
        .unwrap();
        db.perform(
            &first.session_id,
            Operation::Browse {
                database: "information_schema".into(),
                table: "TABLES".into(),
                page: 0,
            },
        )
        .await
        .unwrap();
        let second = db.connect(ConnectionConfig::Sqlite { path }).await.unwrap();
        assert!(execute(&db, &first.session_id, "SELECT 1").await.is_err());
        execute(&db, &second.session_id, "INSERT INTO items VALUES(7)")
            .await
            .unwrap();
        let third = db.connect(mysql()).await.unwrap();
        assert_ne!(third.session_id, first.session_id);
        assert!(execute(&db, &second.session_id, "SELECT 1").await.is_err());
        assert_eq!(
            execute(&db, &third.session_id, "SELECT 43")
                .await
                .unwrap()
                .sets[0]
                .rows[0][0]
                .as_deref(),
            Some("43")
        );
    }
}
