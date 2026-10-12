mod connections;
mod db;
mod passwords;
mod sqlite;

use connections::{ConnectionConfig, Database, Operation};
use db::{ConnectionInfo, DbError, QueryResponse};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn pick_sqlite_file(app: tauri::AppHandle, title: String) -> Result<Option<String>, DbError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .blocking_pick_file()
            .map(|file| {
                file.into_path()
                    .map_err(|_| sqlite::file_error())?
                    .into_os_string()
                    .into_string()
                    .map_err(|_| sqlite::file_error())
            })
            .transpose()
    })
    .await
    .map_err(|_| sqlite::file_error())?
}

#[tauri::command]
async fn get_password(profile_id: String) -> Result<Option<String>, DbError> {
    tauri::async_runtime::spawn_blocking(move || passwords::get(&profile_id))
        .await
        .map_err(|_| passwords::access_error())?
}

#[tauri::command]
async fn save_password(profile_id: String, password: String) -> Result<(), DbError> {
    tauri::async_runtime::spawn_blocking(move || passwords::save(&profile_id, &password))
        .await
        .map_err(|_| passwords::access_error())?
}

#[tauri::command]
async fn delete_password(profile_id: String) -> Result<(), DbError> {
    tauri::async_runtime::spawn_blocking(move || passwords::delete(&profile_id))
        .await
        .map_err(|_| passwords::access_error())?
}

#[tauri::command]
async fn connect(
    config: ConnectionConfig,
    db: State<'_, Database>,
) -> Result<ConnectionInfo, DbError> {
    db.connect(config).await
}

#[tauri::command]
async fn test_connection(config: ConnectionConfig) -> Result<String, DbError> {
    Database::test_connection(config).await
}

#[tauri::command]
async fn disconnect(session_id: String, db: State<'_, Database>) -> Result<(), DbError> {
    db.disconnect(&session_id).await
}

#[tauri::command]
async fn list_databases(
    session_id: String,
    db: State<'_, Database>,
) -> Result<QueryResponse, DbError> {
    db.perform(&session_id, Operation::ListDatabases).await
}

#[tauri::command]
async fn list_tables(
    session_id: String,
    database: String,
    db: State<'_, Database>,
) -> Result<QueryResponse, DbError> {
    db.perform(&session_id, Operation::ListTables { database })
        .await
}

#[tauri::command]
async fn table_structure(
    session_id: String,
    database: String,
    table: String,
    db: State<'_, Database>,
) -> Result<QueryResponse, DbError> {
    db.perform(&session_id, Operation::Structure { database, table })
        .await
}

#[tauri::command]
async fn browse_table(
    session_id: String,
    database: String,
    table: String,
    page: u32,
    db: State<'_, Database>,
) -> Result<QueryResponse, DbError> {
    db.perform(
        &session_id,
        Operation::Browse {
            database,
            table,
            page,
        },
    )
    .await
}

#[tauri::command]
async fn execute_query(
    session_id: String,
    database: Option<String>,
    sql: String,
    db: State<'_, Database>,
) -> Result<QueryResponse, DbError> {
    db.perform(&session_id, Operation::Execute { database, sql })
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Database::default())
        .invoke_handler(tauri::generate_handler![
            pick_sqlite_file,
            get_password,
            save_password,
            delete_password,
            connect,
            test_connection,
            disconnect,
            list_databases,
            list_tables,
            table_structure,
            browse_table,
            execute_query
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MDB");
}
