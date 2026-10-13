import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Database,
  FileCode2,
  KeyRound,
  LoaderCircle,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Terminal,
  X,
} from "lucide-react";
import ConnectionDialog from "./components/ConnectionDialog";
import ResultGrid from "./components/ResultGrid";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { formatNumber, t, useLocale, type MessageKey } from "./i18n";
import {
  call,
  appError,
  databaseError,
  formatDatabaseError,
  loadProfiles,
  quoteIdentifier,
  persistProfiles,
  type ConnectionConfig,
  type ConnectionProfile,
  type DatabaseError,
  type QueryResponse,
  type Session,
} from "./lib/db";
import "./App.css";

type Tab = "sql" | "data" | "structure";
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SQL = {
  mysql:
    "SELECT\n  VERSION() AS version,\n  CURRENT_USER() AS user_name,\n  DATABASE() AS database_name;",
  sqlite: "SELECT sqlite_version() AS version;",
};
interface TableInfo {
  name: string;
  kind: string;
  engine: string | null;
  rows: string | null;
  comment: string | null;
}

function initialProfiles() {
  try {
    return { profiles: loadProfiles(), error: null as DatabaseError | null };
  } catch (error) {
    return {
      profiles: [],
      error: databaseError(error),
    };
  }
}

export default function App() {
  useLocale();
  const [initial] = useState(initialProfiles);
  const [profiles, setProfiles] = useState(initial.profiles);
  const [active, setActive] = useState<ConnectionProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState<string | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<Tab>("sql");
  const [sql, setSql] = useState(DEFAULT_SQL.mysql);
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [tableResult, setTableResult] = useState<QueryResponse | null>(null);
  const [structure, setStructure] = useState<QueryResponse | null>(null);
  const [resultIndex, setResultIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<MessageKey | null>(null);
  const [error, setError] = useState<DatabaseError | null>(null);
  const [catalogWarning, setCatalogWarning] = useState<MessageKey | null>(null);
  const [dialog, setDialog] = useState<{
    profile: ConnectionProfile | null;
    password?: string;
  } | null>(null);
  const [help, setHelp] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarDrag = useRef<{
    pointerId: number;
    x: number;
    width: number;
  } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lock = useRef(false);

  const result =
    tab === "sql" ? queryResult : tab === "data" ? tableResult : structure;
  const set = result?.sets[tab === "sql" ? resultIndex : 0];
  const visibleTables = tables.filter((t) =>
    `${t.name} ${t.comment ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
  );

  function clearTable() {
    setTable(null);
    setTableResult(null);
    setStructure(null);
    setPage(0);
    setTab("sql");
  }
  function clearSession() {
    setSession(null);
    setActive(null);
    setDatabase(null);
    setDatabases([]);
    setTables([]);
    setQueryResult(null);
    setCatalogWarning(null);
    clearTable();
  }

  async function task(label: MessageKey, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (error) {
      const failure = databaseError(error);
      if (failure.sessionLost) clearSession();
      setError(failure);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  async function fetchTables(id: string, name: string) {
    const response = await call<QueryResponse>("list_tables", {
      sessionId: id,
      database: name,
    });
    setTables(
      (response.sets[0]?.rows ?? []).map(
        ([name, kind, engine, rows, comment]) => ({
          name: name!,
          kind: kind!,
          engine,
          rows,
          comment,
        }),
      ),
    );
    setCatalogWarning(
      response.sets.some((s) => s.truncated) ? "warning.tableCatalog" : null,
    );
    return response;
  }

  async function fetchDatabases(id: string) {
    const response = await call<QueryResponse>("list_databases", {
      sessionId: id,
    });
    setDatabases((response.sets[0]?.rows ?? []).map((row) => row[0]!));
    if (response.sets.some((s) => s.truncated))
      setCatalogWarning("warning.databaseCatalog");
    return response;
  }

  async function connect(profile: ConnectionProfile, config: ConnectionConfig) {
    await task("status.connecting", async () => {
      if (initial.error) throw initial.error;
      if (
        !profile.name ||
        (config.engine === "mysql" && (!config.host || !config.username.trim()))
      )
        throw appError("required_fields");
      const next = [...profiles.filter((p) => p.id !== profile.id), profile];
      await persistProfiles(
        next,
        config.engine === "mysql"
          ? () => call("save_password", {
              profileId: profile.id,
              password: config.password,
            })
          : undefined,
      );
      setProfiles(next);
      await openConnection(profile, config);
    });
  }

  async function openConnection(
    profile: ConnectionProfile,
    config: ConnectionConfig,
  ) {
    const info = await call<Session>("connect", { config });
    clearSession();
    setActive(profile);
    setSession(info);
    setDatabase(info.database);
    setSql((current) =>
      current === DEFAULT_SQL.mysql || current === DEFAULT_SQL.sqlite
        ? DEFAULT_SQL[profile.engine]
        : current,
    );
    setDialog(null);
    await fetchDatabases(info.sessionId);
    if (info.database) await fetchTables(info.sessionId, info.database);
  }

  async function connectSaved(profile: ConnectionProfile) {
    // Editing produces a new profile snapshot, including password-only edits.
    if (session && active === profile) return;
    await task("status.connecting", async () => {
      if (profile.engine === "sqlite") {
        await openConnection(profile, { engine: "sqlite", path: profile.path });
        return;
      }
      const password = await call<string | null>("get_password", {
        profileId: profile.id,
      });
      await openConnection(profile, {
        engine: "mysql",
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: password ?? "",
        database: profile.database,
        tls: profile.tls,
      });
    });
  }

  async function editProfile(profile: ConnectionProfile) {
    if (profile.engine === "sqlite") {
      setError(null);
      setDialog({ profile });
      return;
    }
    await task("status.loadingCredentials", async () => {
      const password = await call<string | null>("get_password", {
        profileId: profile.id,
      });
      setDialog({ profile, password: password ?? "" });
    });
  }

  async function removeProfile(id: string) {
    await task("status.deletingConnection", async () => {
      const next = profiles.filter((p) => p.id !== id);
      await persistProfiles(
        next,
        profiles.find((profile) => profile.id === id)?.engine === "mysql"
          ? () => call("delete_password", { profileId: id })
          : undefined,
      );
      setProfiles(next);
      setDialog(null);
      setError(null);
    });
  }

  async function chooseDatabase(name: string) {
    if (!session) return;
    await task("status.loadingTables", async () => {
      clearTable();
      setTables([]);
      setDatabase(name);
      setFilter("");
      await fetchTables(session.sessionId, name);
    });
  }

  async function openTable(
    item: TableInfo,
    nextTab: Tab = "data",
    nextPage = 0,
  ) {
    if (!session || !database) return;
    await task(
      nextTab === "structure"
        ? "status.loadingStructure"
        : "status.loadingData",
      async () => {
        const response = await call<QueryResponse>(
          nextTab === "structure" ? "table_structure" : "browse_table",
          {
            sessionId: session.sessionId,
            database,
            table: item.name,
            page: nextPage,
          },
        );
        if (table?.name !== item.name) {
          setStructure(null);
          setTableResult(null);
        }
        setTable(item);
        setTab(nextTab);
        setPage(nextPage);
        if (nextTab === "structure") setStructure(response);
        else setTableResult(response);
      },
    );
  }

  async function runQuery() {
    if (!session || lock.current) return;
    const area = editor.current;
    const selected = area
      ? sql.slice(area.selectionStart, area.selectionEnd)
      : "";
    const statement = selected.trim() || sql.trim();
    if (!statement) return;
    await task("status.runningSQL", async () => {
      setQueryResult(null);
      setResultIndex(0);
      const response = await call<QueryResponse>("execute_query", {
        sessionId: session.sessionId,
        database,
        sql: statement,
      });
      setQueryResult(response);
      if (response.database !== database) {
        clearTable();
        setDatabase(response.database);
        setTables([]);
        await fetchDatabases(session.sessionId);
        if (response.database)
          await fetchTables(session.sessionId, response.database);
      }
    });
  }

  async function refresh() {
    if (!session) return;
    await task("status.refreshingCatalog", async () => {
      const catalog = (await fetchDatabases(session.sessionId)).sets[0];
      if (
        database &&
        catalog &&
        !catalog.truncated &&
        !catalog.rows.some(([name]) => name === database)
      ) {
        setDatabase(null);
        setTables([]);
        clearTable();
      } else if (database) {
        const catalog = (await fetchTables(session.sessionId, database))
          .sets[0];
        if (
          table &&
          catalog &&
          !catalog.truncated &&
          !catalog.rows.some(([name]) => name === table.name)
        )
          clearTable();
      }
    });
  }

  async function disconnect() {
    if (!session) return;
    await task("status.disconnecting", async () => {
      await call("disconnect", { sessionId: session.sessionId });
      clearSession();
    });
  }

  function switchTab(next: Tab) {
    if (next === "sql") {
      setTab("sql");
      return;
    }
    if (table) void openTable(table, next, next === "data" ? page : 0);
  }

  return (
    <div
      className={`app-shell${resizingSidebar ? " resizing-sidebar" : ""}`}
      style={{
        gridTemplateColumns: `${sidebarCollapsed ? 0 : sidebarWidth}px minmax(0, 1fr)`,
      }}
    >
      <aside
        id="database-sidebar"
        className="sidebar"
        hidden={sidebarCollapsed}
        aria-label={t("nav.databaseNavigation")}
      >
        <div className="brand">
          <div className="brand-icon">
            <Database size={23} strokeWidth={1.8} />
          </div>
          <div>
            <strong>
              mdb<span>.</span>
            </strong>
            <small>{t("app.workbench")}</small>
          </div>
          <span className="version-tag">0.1.1</span>
        </div>
        <div className="sidebar-heading">
          <span>{t("nav.connections")}</span>
          <button
            className="icon-button"
            aria-label={t("nav.newConnection")}
            title={t("nav.newConnection")}
            disabled={!!busy || !!initial.error}
            onClick={() => {
              setError(null);
              setDialog({ profile: null });
            }}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="connection-list">
          {profiles.length === 0 && (
            <div className="sidebar-empty">
              <Network size={23} />
              <p>{t("nav.noConnections")}</p>
              <span>
                {t("nav.addServer")}
                <br />
                {t("nav.startBrowsing")}
              </span>
            </div>
          )}
          {profiles.map((profile) => (
            <div key={profile.id}>
              <div className="connection-row">
                <button
                  className={`connection-item ${active === profile ? "connected" : ""}`}
                  disabled={!!busy}
                  title={t("connection.connectHint")}
                  onDoubleClick={() => void connectSaved(profile)}
                  onClick={(event) => {
                    if (event.detail === 0) void connectSaved(profile);
                  }}
                >
                  <Database size={17} />
                  <span>
                    <strong>{profile.name}</strong>
                    <small>
                      {profile.engine === "sqlite"
                        ? profile.path
                        : `${profile.host}:${profile.port}`}
                    </small>
                  </span>
                  <i
                    className={`status-dot ${active === profile ? "online" : ""}`}
                  />
                </button>
                <button
                  className="icon-button connection-edit"
                  disabled={!!busy}
                  aria-label={t("connection.edit", { name: profile.name })}
                  title={t("connection.settings")}
                  onClick={() => void editProfile(profile)}
                >
                  <Pencil size={14} />
                </button>
              </div>
              {active === profile && (
                <div className="database-tree">
                  {databases.map((name) => (
                    <div key={name}>
                      <button
                        disabled={!!busy}
                        className={`database-item ${database === name ? "selected" : ""}`}
                        onClick={() => void chooseDatabase(name)}
                        title={name}
                      >
                        {database === name ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <Database size={14} />
                        <span>{name}</span>
                      </button>
                      {database === name && (
                        <>
                          <label className="table-search">
                            <Search size={13} />
                            <input
                              aria-label={t("nav.filterTables")}
                              placeholder={t("nav.filterPlaceholder")}
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                            />
                          </label>
                          {visibleTables.map((item) => (
                            <button
                              key={item.name}
                              disabled={!!busy}
                              title={item.comment || item.name}
                              className={`table-item ${table?.name === item.name ? "selected" : ""}`}
                              onClick={() => void openTable(item)}
                            >
                              <Table2 size={14} />
                              <span>{item.name}</span>
                              {item.kind === "VIEW" && (
                                <small>{t("nav.view")}</small>
                              )}
                            </button>
                          ))}
                          {visibleTables.length === 0 && (
                            <p className="tree-empty">
                              {busy
                                ? t("nav.loading")
                                : filter
                                  ? t("nav.noMatchingTables")
                                  : t("nav.noTables")}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  {databases.length === 0 && (
                    <p className="tree-empty">
                      {busy ? t("nav.loading") : t("nav.noDatabases")}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <span>
            <ShieldCheck size={14} />
            {t("nav.localProfiles")}
          </span>
          <LanguageSwitcher />
          <button
            className="help-button"
            onClick={() => setHelp(!help)}
            aria-expanded={help}
          >
            <CircleHelp size={16} />
            {t("nav.help")}
          </button>
        </div>
        <div
          className="sidebar-resizer"
          role="separator"
          tabIndex={0}
          aria-label={t("nav.resizeSidebar")}
          aria-controls="database-sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          onPointerDown={(event) => {
            if (event.button !== 0 || sidebarDrag.current) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            sidebarDrag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              width: sidebarWidth,
            };
            setResizingSidebar(true);
          }}
          onPointerMove={(event) => {
            if (
              !sidebarDrag.current ||
              sidebarDrag.current.pointerId !== event.pointerId
            ) return;
            setSidebarWidth(
              Math.max(
                MIN_SIDEBAR_WIDTH,
                Math.min(
                  MAX_SIDEBAR_WIDTH,
                  sidebarDrag.current.width +
                    event.clientX -
                    sidebarDrag.current.x,
                ),
              ),
            );
          }}
          onLostPointerCapture={(event) => {
            if (sidebarDrag.current?.pointerId !== event.pointerId) return;
            sidebarDrag.current = null;
            setResizingSidebar(false);
          }}
          onKeyDown={(event) => {
            const widths: Record<string, number> = {
              ArrowLeft: sidebarWidth - 10,
              ArrowRight: sidebarWidth + 10,
              Home: MIN_SIDEBAR_WIDTH,
              End: MAX_SIDEBAR_WIDTH,
            };
            if (!(event.key in widths)) return;
            event.preventDefault();
            setSidebarWidth(
              Math.max(
                MIN_SIDEBAR_WIDTH,
                Math.min(MAX_SIDEBAR_WIDTH, widths[event.key]),
              ),
            );
          }}
        />
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div className="connection-title">
            <button
              className="icon-button"
              aria-label={t(
                sidebarCollapsed ? "nav.expandSidebar" : "nav.collapseSidebar",
              )}
              title={t(
                sidebarCollapsed ? "nav.expandSidebar" : "nav.collapseSidebar",
              )}
              aria-controls="database-sidebar"
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            <span className={`status-dot ${session ? "online" : ""}`} />
            <strong>{active?.name ?? t("workspace.title")}</strong>
            <span className="header-divider" />
            <span className="host-label">
              {active
                ? active.engine === "sqlite"
                  ? active.path
                  : `${active.username}@${active.host}:${active.port}`
                : t("status.disconnected")}
            </span>
          </div>
          <div className="header-actions">
            {session && (
              <>
                <button
                  className="icon-button"
                  aria-label={t("workspace.refreshCatalog")}
                  title={t("workspace.refreshCatalog")}
                  disabled={!!busy}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t("workspace.disconnect")}
                  title={t("workspace.disconnect")}
                  disabled={!!busy}
                  onClick={() => void disconnect()}
                >
                  <Power size={17} />
                </button>
              </>
            )}
            <button
              className="button"
              disabled={!!busy || !!initial.error}
              onClick={() => {
                setError(null);
                setDialog({ profile: null });
              }}
            >
              <Plus size={15} />
              {t("nav.newConnection")}
            </button>
          </div>
        </header>

        <nav className="workspace-tabs" aria-label={t("workspace.views")}>
          <button
            className={tab === "sql" ? "active" : ""}
            disabled={!!busy}
            onClick={() => switchTab("sql")}
          >
            <Terminal size={16} />
            {t("workspace.sql")}
          </button>
          {table && (
            <>
              <button
                className={tab === "data" ? "active" : ""}
                disabled={!!busy}
                onClick={() => switchTab("data")}
              >
                <Table2 size={16} />
                {table.name}
              </button>
              <button
                className={tab === "structure" ? "active" : ""}
                disabled={!!busy}
                onClick={() => switchTab("structure")}
              >
                <KeyRound size={15} />
                {t("workspace.structure")}
              </button>
            </>
          )}
          <span className="tabs-context">
            {active?.engine === "sqlite" && tab === "sql"
              ? t("editor.sqliteScope")
              : database ?? t("workspace.noDatabase")}
          </span>
        </nav>

        {initial.error && (
          <div className="notice error" role="alert">
            {t("error.readProfiles", {
              message: formatDatabaseError(initial.error),
            })}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <span>{formatDatabaseError(error)}</span>
            <button
              className="icon-button"
              aria-label={t("error.close")}
              onClick={() => setError(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {catalogWarning && (
          <div className="notice warning">{t(catalogWarning)}</div>
        )}
        {help && (
          <div className="help-panel">
            <div>
              <strong>{t("help.title")}</strong>
              <button
                className="icon-button"
                aria-label={t("help.close")}
                onClick={() => setHelp(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p>{t("help.start")}</p>
            <p>{t("help.limits")}</p>
            <p>{t("help.session")}</p>
          </div>
        )}

        {!session ? (
          <section className="welcome">
            <div className="welcome-visual" aria-hidden="true">
              <div className="visual-table">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="visual-database">
                <Database size={48} strokeWidth={1.3} />
              </div>
              <div className="visual-query">
                <FileCode2 size={19} />
                <span>SELECT *</span>
              </div>
            </div>
            <span className="welcome-kicker">{t("welcome.kicker")}</span>
            <h1>{t("welcome.title")}</h1>
            <p>
              {t("welcome.description")}
              <br />
              {t("welcome.clientDescription")}
            </p>
            <button
              className="button primary large"
              disabled={!!busy || !!initial.error}
              onClick={() => {
                setError(null);
                setDialog({ profile: null });
              }}
            >
              <Plus size={17} />
              {t("welcome.newConnection")}
            </button>
            <div className="welcome-features">
              <span>
                <Database size={15} />
                MySQL / SQLite
              </span>
              <span>
                <Terminal size={15} />
                {t("welcome.editor")}
              </span>
              <span>
                <Table2 size={15} />
                {t("welcome.browse")}
              </span>
            </div>
          </section>
        ) : (
          <>
            {tab === "sql" ? (
              <section className="editor-panel" aria-label={t("editor.region")}>
                <div className="editor-toolbar">
                  <div>
                    <FileCode2 size={15} />
                    <strong>{t("editor.title")}</strong>
                    <span className="muted">{t("editor.supportsScripts")}</span>
                  </div>
                  <button
                    className="button primary"
                    disabled={!!busy || !sql.trim()}
                    onClick={() => void runQuery()}
                  >
                    {busy === "status.runningSQL" ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                    {t("editor.run")}
                    <kbd>⌘ ↵</kbd>
                  </button>
                </div>
                {active?.engine === "sqlite" && (
                  <div className="notice warning">
                    {t("editor.sqliteContext", { database: database ?? "main" })}
                  </div>
                )}
                <div className="editor-area">
                  <div ref={gutter} className="line-numbers" aria-hidden="true">
                    {sql.split("\n").map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    ref={editor}
                    aria-label={t("workspace.sql")}
                    value={sql}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    disabled={!!busy}
                    onScroll={(e) => {
                      if (gutter.current)
                        gutter.current.scrollTop = e.currentTarget.scrollTop;
                    }}
                    onChange={(e) => setSql(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void runQuery();
                      }
                    }}
                  />
                </div>
                <div className="editor-footer">
                  <span>{t("editor.selectionHint")}</span>
                  <span>{t("editor.shortcut")}</span>
                </div>
              </section>
            ) : (
              <div className="table-toolbar">
                <div>
                  <Table2 size={19} />
                  <strong>{table?.name}</strong>
                  {table?.engine && <span className="tag">{table.engine}</span>}
                  <span className="muted">
                    {tab === "structure"
                      ? t("table.fieldsHint")
                      : table?.rows
                        ? t("table.approxRows", {
                            count: formatNumber(BigInt(table.rows)),
                          })
                        : t("table.browse")}
                  </span>
                </div>
                <div>
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() => {
                      setSql(
                        `SELECT *\nFROM ${quoteIdentifier(database!)}.${quoteIdentifier(table!.name)}\nLIMIT 100;`,
                      );
                      setTab("sql");
                    }}
                  >
                    <Terminal size={14} />
                    {t("table.openSQL")}
                  </button>
                  <button
                    className="icon-button"
                    disabled={!!busy}
                    aria-label={t("table.refresh")}
                    onClick={() => table && void openTable(table, tab, page)}
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>
            )}

            <section className="results-panel" aria-label={t("result.region")}>
              <div className="result-toolbar">
                <div>
                  <Table2 size={15} />
                  <strong>
                    {tab === "structure"
                      ? t("workspace.structure")
                      : t("result.title")}
                  </strong>
                  {set && (
                    <span className="result-count">
                      {set.columns.length
                        ? t(
                            tab === "structure"
                              ? "result.fields"
                              : "result.rows",
                            { count: formatNumber(set.rows.length) },
                          )
                        : t("result.affected", {
                            count: formatNumber(BigInt(set.affectedRows)),
                          })}
                    </span>
                  )}
                  {result && (
                    <span className="muted">
                      {formatNumber(result.elapsedMs)} ms
                    </span>
                  )}
                </div>
                {tab === "data" && (
                  <div className="pagination">
                    <button
                      className="icon-button"
                      aria-label={t("result.previousPage")}
                      disabled={!!busy || page === 0}
                      onClick={() =>
                        table && void openTable(table, "data", page - 1)
                      }
                    >
                      <ChevronsLeft size={17} />
                    </button>
                    <span>
                      {t("result.page", { page: formatNumber(page + 1) })}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={t("result.nextPage")}
                      disabled={!!busy || !tableResult?.hasMore}
                      onClick={() =>
                        table && void openTable(table, "data", page + 1)
                      }
                    >
                      <ChevronsRight size={17} />
                    </button>
                  </div>
                )}
              </div>
              {result && result.sets.length > 1 && tab === "sql" && (
                <div className="result-tabs">
                  {result.sets.map((_, i) => (
                    <button
                      key={i}
                      className={i === resultIndex ? "active" : ""}
                      onClick={() => setResultIndex(i)}
                    >
                      {t("result.set", { index: formatNumber(i + 1) })}
                    </button>
                  ))}
                </div>
              )}
              {(set?.truncated || result?.setsTruncated) && (
                <div className="notice warning">{t("result.limit")}</div>
              )}
              {busy ? (
                <div className="result-empty">
                  <LoaderCircle size={26} className="spin" />
                  <h3>{t(busy)}</h3>
                </div>
              ) : set ? (
                <ResultGrid
                  result={set}
                  offset={tab === "data" ? page * 100 : 0}
                />
              ) : (
                <div className="result-empty">
                  <div className="result-placeholder">
                    <Terminal size={26} />
                  </div>
                  <h3>{t("result.waiting")}</h3>
                  <p>{t("result.waitingHint")}</p>
                </div>
              )}
            </section>
          </>
        )}
        <footer className="status-bar">
          <span>
            <i className={`status-dot ${session ? "online" : ""}`} />
            {busy
              ? t(busy)
              : t(session ? "status.connected" : "status.disconnected")}
          </span>
          <span>
            {session
              ? `${active?.engine === "sqlite" ? "SQLite" : "MySQL"} ${session.version}`
              : t("app.client")}
          </span>
          {session && active?.engine === "mysql" && (
            <span>
              {t(active?.tls ? "status.tlsEnabled" : "status.tlsDisabled")}
            </span>
          )}
          <span className="status-end">{database ?? "MDB"}</span>
        </footer>
      </main>
      {dialog && (
        <ConnectionDialog
          key={dialog.profile?.id ?? "new"}
          profile={dialog.profile}
          active={dialog.profile?.id === active?.id}
          busy={!!busy}
          error={error}
          initialPassword={dialog.password}
          onClose={() => {
            setDialog(null);
            setError(null);
          }}
          onConnect={connect}
          onDelete={removeProfile}
        />
      )}
    </div>
  );
}
