# MDB

[English](README.md) | [简体中文](README.zh-CN.md)

A desktop database client for **MySQL and SQLite**, built with TypeScript, React and Tauri 2. Rust connects directly through `mysql_async` and `rusqlite`; the frontend calls typed Tauri commands.

## Installation

The macOS build supports Apple Silicon Macs running macOS 11 or later.

```bash
brew install --cask myersguo/tap/mdb
```

Alternatively, download `MDB-0.1.1-macos-arm64.zip` and `SHA256SUMS` from [GitHub Releases](https://github.com/myersguo/mdb/releases). Verify the checksum, extract the archive and move `MDB.app` to Applications.

The application is ad-hoc signed, but not Developer ID signed or notarized. macOS may require first-launch approval in Privacy & Security. Windows and Linux builds have not been verified.

## Features

- Save, edit, delete and test connection settings; connect and disconnect.
- Choose MySQL or SQLite when creating a connection. Open an existing SQLite file using the native file picker or an absolute path, then browse tables, views and fields or execute SQL.
- Save MySQL passwords in the system credential store by default. Double-click a saved connection, or focus it and press Enter / Space, to connect. Use its edit button to change settings and passwords.
- Browse accessible databases and tables; filter tables by name or comment.
- Collapse or expand the sidebar from the workspace header, and drag its right edge to resize it between 200 and 480px. Keyboard users can focus the divider and use arrow keys or Home / End. Collapsing preserves the active connection, SQL draft and width within the current session.
- Browse table data in pages of 100 rows, ordered by primary key when available.
- Inspect field types, defaults, key markers and comments.
- Execute SQL scripts or a selected fragment with ⌘ / Ctrl + Enter.
- Display multiple result sets, duplicate column names, NULL and binary values as hexadecimal strings. MySQL BIGINT/DECIMAL and SQLite integers retain precision as strings. SQLite REAL displays the stored floating-point value; declaring a column DECIMAL does not change SQLite's native type semantics.
- Switch between English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish and French. Initial language follows the system; later choices use `mdb.locale`. Language changes preserve the active session, SQL draft and results.

Typed dictionaries follow the AGM convention: English defines message keys and other dictionaries are checked at compile time. UI text and MDB-owned errors change with the selected language. Connection names, identifiers, SQL, data and raw database errors retain their original content.

MDB has one active connection. MySQL user SQL uses the text protocol, supporting scripts and stored procedures. `DELIMITER` is a mysql CLI directive and should be omitted from procedure definitions sent through MDB. SQLite scripts use the native parser, including strings and triggers containing semicolons. Metadata queries use parameter binding or quoted identifiers.

Writes and DDL act directly on the database under the current database or file permissions. Scripts are not automatically wrapped in a transaction. After a failure, verify writes and transaction state; rollback behavior follows the engine and the SQL executed.

## Development

Requirements: Node.js 22.12+, Rust stable and [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/). Local verification used Node.js 24, Rust 1.92 and macOS arm64.

```bash
npm ci
npm run tauri dev
```

`npm run dev` starts the browser interface preview. Database connections require the desktop runtime.

Build the macOS application:

```bash
npm run build:app
```

Output: `src-tauri/target/release/bundle/macos/MDB.app`. The bundle uses ad-hoc signing. Other platforms can use `npm run tauri build`, but Windows/Linux packaging has not been verified.

## Validation

```bash
npm run typecheck
npm test
npm run test:rust
npm run test:mysql
npm run test:credentials
```

`test:mysql` requires Python 3 and `mysql` / `mysqld` on PATH. It starts a disposable server on a random loopback port, runs real integration tests and cleans up the process and temporary directory. It does not use an existing local server. Coverage includes data types, reads/writes, quoted identifiers, paging, display limits, error recovery, procedures, multiple results, partial execution, session switching and the 30-second timeout.

`test:rust` exercises the real SQLite engine using a single in-memory connection and temporary files. It covers persistence, values, metadata, paging, triggers, RETURNING, display limits, partial execution, timeout and transaction rollback on switching. `test:mysql` also verifies MySQL → SQLite → MySQL switching and stale-session rejection.

`test:credentials` uses a unique temporary credential to check save, read, update to an empty password and delete, then removes it. macOS Keychain is verified. Windows Credential Manager and Linux Secret Service remain unverified; Linux requires an available, unlocked Secret Service.

For manual interface testing:

```bash
python3 scripts/test-mysql.py --serve
```

The script creates `mdb_demo.orders` and prints its random port. Connect using host `127.0.0.1`, user `root`, an empty password, database `mdb_demo` and TLS disabled. Press Enter in the terminal to stop and clean up the test server.

## Data and session boundaries

- Connection metadata is stored in WebView localStorage (`mdb.connections.v1`). Legacy MySQL profiles retain their IDs and credentials. Rust/keyring stores MySQL passwords under service `com.myersguo.mdb` and the profile ID; metadata JSON contains no passwords. SQLite stores only the file path and does not access credentials. Deleting a SQLite profile preserves its database file.
- Metadata write failures leave credentials untouched. Credential-command failures restore the original metadata and preserve the form for retry. Metadata and credentials are separate stores; terminating the process midway is not covered by a cross-store transaction.
- MySQL enables TLS and verifies server certificates by default using public trust roots. Custom CAs, client certificates and SSH tunnels are not supported. TLS may be disabled for the local test server.
- MySQL connection timeout is 10 seconds; query timeout is 30 seconds. Timeout or protocol failure discards the session without automatic retries. Writes may already have executed, so the interface warns about uncertain outcomes.
- SQLite bundles its engine and opens existing standard database files without creating a database for a mistyped path. Files open read/write, foreign keys are enabled and busy waits are bounded to 5 seconds. Work runs on background threads with a 30-second VM progress-handler timeout; filesystem calls depend on the OS. Timeout closes the session, but earlier committed script writes may remain.
- Query display is limited to 1,000 rows, 4 MiB of cell content and 20 result sets. Truncation is indicated explicitly. MDB does not append LIMIT automatically; complete export would require streaming support.
- Switching or disconnecting ends the session and rolls back uncommitted transactions on connection close. SQLite has no USE statement: choosing a schema in the browse tree does not change SQL name resolution. The editor explains this; qualify names such as `extra.items` when targeting attached databases.
- OFFSET paging is not a stable snapshot for tables without primary keys or under concurrent changes. Use SQL with an explicit ORDER BY when reproducible ordering is required.

Import/export, grid editing, a graphical table designer, concurrent connections, query history and SQL completion are not implemented.

## Source entry points

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Connections, navigation, editor and result state |
| `src/components/` | Connection form and result grid |
| `src/i18n.tsx`, `src/locales/` | Language resolution, persistence and typed dictionaries |
| `src/lib/db.ts` | IPC contracts and connection metadata persistence |
| `src-tauri/src/lib.rs` | Tauri command registration |
| `src-tauri/src/db.rs` | MySQL sessions, conversion, bounds and integration tests |
| `src-tauri/src/connections.rs` | Single-session coordination, driver dispatch and session ID validation |
| `src-tauri/src/sqlite.rs` | SQLite files, scripts, metadata, bounds and engine tests |
| `src-tauri/src/passwords.rs` | Credential storage and disposable roundtrip test |

Framework and driver references: [Tauri Vite integration](https://v2.tauri.app/start/frontend/vite/), [mysql_async](https://docs.rs/mysql_async/0.37.1/mysql_async/), [rusqlite](https://docs.rs/rusqlite/0.40.2/rusqlite/) and [Tauri Dialog](https://v2.tauri.app/plugin/dialog/).

## Release workflow

The initial distribution target is macOS arm64, macOS 11+. The project is licensed under [MIT](LICENSE).

`.github/workflows/ci.yml` runs type checks, tests, Rust fmt/Clippy, dependency audits and isolated MySQL integration tests on main, version tags and pull requests, then builds arm64. Credential roundtrip tests require a usable local credential store. CI produces a signature-verified archive, SHA256SUMS and cask for maintainers to inspect; it does not publish releases or modify the tap automatically.

Package locally:

```bash
npm run build:app
npm run package:macos
```

The packaging command verifies matching package/Cargo/Tauri versions, application version, arm64 architecture and full bundle signature, then extracts the archive and verifies its signature again. Outputs under the ignored `release/` directory are `MDB-0.1.1-macos-arm64.zip`, `SHA256SUMS` and `mdb.rb`. The archive includes LICENSE.

Publish the ZIP and SHA256SUMS under the matching version tag in [GitHub Releases](https://github.com/myersguo/mdb/releases). Verify the downloaded checksum against the cask before updating `mdb.rb` in [homebrew-tap](https://github.com/myersguo/homebrew-tap). Published archives must remain immutable; changes require a new version.

Ad-hoc signing does not replace notarization. Windows/Linux remain unverified, and the Rust audit's Linux GTK/glib warnings remain unresolved.
