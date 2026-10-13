import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "./App";
import type { QueryResponse } from "./lib/db";
import { LocaleProvider } from "./i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

function response(
  names: string[],
  rows: (string | null)[][],
  database: string | null = "shop",
): QueryResponse {
  return {
    sets: [
      {
        columns: names.map((name) => ({ name, dataType: "VARCHAR" })),
        rows,
        affectedRows: "0",
        truncated: false,
      },
    ],
    database,
    elapsedMs: 8,
    setsTruncated: false,
    hasMore: false,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem("mdb.locale", "zh");
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (command) {
      case "get_password":
        return "a@b:/?#%";
      case "save_password":
      case "delete_password":
        return undefined;
      case "connect":
        return { sessionId: "session-1", version: "8.4.0", database: null };
      case "test_connection":
        return "8.4.0";
      case "list_databases":
        return response(["Database"], [["shop"]], null);
      case "list_tables":
        return response(
          ["name", "kind", "engine", "rows", "comment"],
          [["orders", "BASE TABLE", "InnoDB", "101", "Orders"]],
        );
      case "browse_table":
        return response(
          ["id", "amount", "note"],
          [["18446744073709551615", "9999999999999999.123456", null]],
        );
      case "table_structure":
        return response(
          ["Field", "Type", "Key"],
          [["id", "bigint unsigned", "PRI"]],
        );
      case "execute_query":
        return response(["answer"], [["42"]]);
      case "disconnect":
        return undefined;
      default:
        throw new Error(`Unexpected command ${command}`);
    }
  });
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

it("collapses and restores the sidebar without losing its width, connection or SQL draft", async () => {
  renderApp();
  const user = await connect();
  const sidebar = screen.getByRole("complementary", { name: "数据库导航" });
  const resizer = screen.getByRole("separator", { name: "调整侧栏宽度" });
  fireEvent.keyDown(resizer, { key: "ArrowRight" });
  const area = screen.getByRole("textbox", {
    name: "SQL 查询",
  }) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "SELECT 99;" } });
  vi.mocked(invoke).mockClear();

  await user.click(screen.getByRole("button", { name: "收起侧栏" }));
  expect(sidebar.hidden).toBe(true);
  expect(screen.queryByRole("separator")).toBeNull();
  expect(area.value).toBe("SELECT 99;");
  expect(
    screen.getByRole("button", { name: "展开侧栏" }).getAttribute("aria-expanded"),
  ).toBe("false");
  expect(sidebar.parentElement?.style.gridTemplateColumns).toBe("0px minmax(0, 1fr)");

  await user.click(screen.getByRole("button", { name: "展开侧栏" }));
  expect(sidebar.hidden).toBe(false);
  expect(resizer.getAttribute("aria-valuenow")).toBe("258");
  expect(sidebar.parentElement?.style.gridTemplateColumns).toBe(
    "258px minmax(0, 1fr)",
  );
  expect(screen.getByRole("button", { name: "shop" })).toBeTruthy();
  expect(area.value).toBe("SELECT 99;");
  expect(invoke).not.toHaveBeenCalled();
});

it("bounds keyboard sidebar resizing and leaves unrelated keys alone", () => {
  renderApp();
  const resizer = screen.getByRole("separator", { name: "调整侧栏宽度" });
  fireEvent.keyDown(resizer, { key: "Home" });
  fireEvent.keyDown(resizer, { key: "ArrowLeft" });
  expect(resizer.getAttribute("aria-valuenow")).toBe("200");
  fireEvent.keyDown(resizer, { key: "End" });
  fireEvent.keyDown(resizer, { key: "ArrowRight" });
  expect(resizer.getAttribute("aria-valuenow")).toBe("480");
  fireEvent.keyDown(resizer, { key: "Tab" });
  expect(resizer.getAttribute("aria-valuenow")).toBe("480");
});

it("resizes with captured pointer movement, ignores other pointers and stops after capture is lost", () => {
  renderApp();
  const resizer = screen.getByRole("separator", { name: "调整侧栏宽度" });
  const capture = vi.fn();
  Object.defineProperty(resizer, "setPointerCapture", { value: capture });
  const pointer = (name: string, x: number, pointerId = 1, button = 0) => {
    const event = new MouseEvent(name, { bubbles: true, clientX: x, button });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    fireEvent(resizer, event);
  };
  pointer("pointerdown", 248, 1, 2);
  expect(capture).not.toHaveBeenCalled();
  pointer("pointerdown", 248);
  expect(capture).toHaveBeenCalledWith(1);
  pointer("pointermove", 348, 2);
  expect(resizer.getAttribute("aria-valuenow")).toBe("248");
  pointer("pointermove", 348);
  expect(resizer.getAttribute("aria-valuenow")).toBe("348");
  pointer("pointermove", 900);
  expect(resizer.getAttribute("aria-valuenow")).toBe("480");
  pointer("pointermove", 0);
  expect(resizer.getAttribute("aria-valuenow")).toBe("200");
  pointer("lostpointercapture", 0);
  pointer("pointermove", 400);
  expect(resizer.getAttribute("aria-valuenow")).toBe("200");
  expect(resizer.closest(".resizing-sidebar")).toBeNull();
});

async function connect() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新建数据库连接" }));
  await user.type(screen.getByLabelText("密码", { exact: true }), "a@b:/?#%");
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  await screen.findByRole("button", { name: "shop" });
  expect(invoke).toHaveBeenCalledWith("save_password", {
    profileId: expect.any(String),
    password: "a@b:/?#%",
  });
  return user;
}

it("connects, browses precise values and NULL, reads schema, and runs selected SQL", async () => {
  renderApp();
  const user = await connect();
  expect(localStorage.getItem("mdb.connections.v1")).not.toContain("a@b");
  await user.click(screen.getByRole("button", { name: "shop" }));
  await user.click(await screen.findByRole("button", { name: "orders" }));
  expect(await screen.findByText("18446744073709551615")).toBeTruthy();
  expect(screen.getByText("9999999999999999.123456")).toBeTruthy();
  expect(screen.getByText("NULL")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "表结构" }));
  expect(await screen.findByText("bigint unsigned")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "SQL 查询" }));
  const area = screen.getByRole("textbox", {
    name: "SQL 查询",
  }) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "SELECT 42;\nSELECT 99;" } });
  area.setSelectionRange(0, 10);
  fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
  expect(await screen.findByText("42")).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("execute_query", {
    sessionId: "session-1",
    database: "shop",
    sql: "SELECT 42;",
  });
});

it("keeps the connection after a SQL error and permits a corrected query", async () => {
  renderApp();
  const user = await connect();
  vi.mocked(invoke).mockRejectedValueOnce({
    message: "Unknown column",
    sessionLost: false,
    outcomeUnknown: false,
  });
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Unknown column",
  );
  expect(screen.getByRole("button", { name: "断开连接" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  expect(await screen.findByText("42")).toBeTruthy();
});

it("invalidates the session after a timeout and does not retry the write", async () => {
  renderApp();
  const user = await connect();
  vi.mocked(invoke).mockRejectedValueOnce({
    message: "查询超时，写入结果不确定",
    sessionLost: true,
    outcomeUnknown: true,
  });
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  expect(await screen.findByText("从一个连接开始")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "断开连接" })).toBeNull();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "execute_query"),
  ).toHaveLength(1);
});

it("does not replace an active session when a new connection fails", async () => {
  renderApp();
  const user = await connect();
  await user.click(
    within(screen.getByRole("banner")).getByRole("button", {
      name: "新建连接",
    }),
  );
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText("连接成功 · MySQL 8.4.0");
  vi.mocked(invoke).mockResolvedValueOnce(undefined).mockRejectedValueOnce({
    message: "Access denied",
    sessionLost: false,
    outcomeUnknown: false,
  });
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  await waitFor(() =>
    expect(screen.getAllByText("Access denied").length).toBeGreaterThan(0),
  );
  expect(screen.queryByText("连接成功 · MySQL 8.4.0")).toBeNull();
  await user.click(screen.getByRole("button", { name: "关闭连接设置" }));
  expect(screen.getByRole("button", { name: "断开连接" })).toBeTruthy();
});

it("clears deleted tables and databases when refreshing the catalog", async () => {
  renderApp();
  const user = await connect();
  await user.click(screen.getByRole("button", { name: "shop" }));
  await user.click(await screen.findByRole("button", { name: "orders" }));
  await screen.findByText("18446744073709551615");
  vi.mocked(invoke)
    .mockResolvedValueOnce(response(["Database"], [["shop"]], null))
    .mockResolvedValueOnce(response(["name"], []));
  await user.click(screen.getByRole("button", { name: "刷新数据库目录" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "orders" })).toBeNull(),
  );
  expect(screen.queryByRole("table")).toBeNull();
  vi.mocked(invoke).mockResolvedValueOnce(response(["Database"], [], null));
  await user.click(screen.getByRole("button", { name: "刷新数据库目录" }));
  await screen.findByText("未选择数据库");
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  await screen.findByText("42");
  expect(invoke).toHaveBeenCalledWith(
    "execute_query",
    expect.objectContaining({ database: null }),
  );
});

it("disables the next page at the end and preserves headers of an empty result", async () => {
  renderApp();
  const user = await connect();
  await user.click(screen.getByRole("button", { name: "shop" }));
  await user.click(await screen.findByRole("button", { name: "orders" }));
  expect(
    (screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "SQL 查询" }));
  vi.mocked(invoke).mockResolvedValueOnce(
    response(["duplicate", "duplicate"], []),
  );
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  expect(await screen.findByText("没有返回记录")).toBeTruthy();
  expect(
    within(screen.getByRole("table")).getAllByText("duplicate"),
  ).toHaveLength(2);
});

async function chooseLanguage(
  user: ReturnType<typeof userEvent.setup>,
  language: string,
) {
  await user.click(document.querySelector(".language-menu summary")!);
  await user.click(screen.getByRole("button", { name: language }));
}

it("switches the active workspace without changing SQL, data, or the database session, and restores the preference", async () => {
  const view = renderApp();
  const user = await connect();
  await user.click(screen.getByRole("button", { name: "shop" }));
  await user.click(await screen.findByRole("button", { name: "orders" }));
  await user.click(screen.getByRole("button", { name: "SQL 查询" }));
  const editor = screen.getByRole("textbox", {
    name: "SQL 查询",
  }) as HTMLTextAreaElement;
  const draft = "SELECT '中文内容' AS original_name;";
  fireEvent.change(editor, { target: { value: draft } });
  vi.mocked(invoke).mockResolvedValueOnce(
    response(
      ["original_name", "amount", "empty"],
      [["中文内容", "9999999999999999.123456", ""]],
    ),
  );
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  await screen.findByText("空字符串");
  editor.setSelectionRange(0, 6);
  const commands = vi.mocked(invoke).mock.calls.length;
  await user.click(document.querySelector(".language-menu summary")!);
  for (const language of [
    "English",
    "简体中文",
    "繁體中文",
    "日本語",
    "한국어",
    "Español",
    "Français",
  ]) {
    expect(screen.getByRole("button", { name: language })).toBeTruthy();
  }
  await user.click(screen.getByRole("button", { name: "English" }));
  expect(document.querySelector(".language-menu")!.hasAttribute("open")).toBe(
    false,
  );
  expect(document.activeElement).toBe(
    document.querySelector(".language-menu summary"),
  );
  expect(screen.getByRole("textbox", { name: "SQL query" })).toBe(editor);
  expect(editor.value).toBe(draft);
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 6]);
  expect(screen.getByText("Empty string")).toBeTruthy();
  expect(screen.getByText("中文内容")).toBeTruthy();
  expect(screen.getByText("9999999999999999.123456")).toBeTruthy();
  expect(screen.getByText("original_name")).toBeTruthy();
  expect(screen.getByRole("button", { name: "shop" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  expect(invoke).toHaveBeenCalledTimes(commands);
  expect(localStorage.getItem("mdb.locale")).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  expect(document.title).toBe("MDB — Database Workbench");
  view.unmount();
  renderApp();
  expect(
    screen.getByRole("button", { name: "New database connection" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: /^本地 MySQL/ })).toBeTruthy();
});

it("retranslates an existing script warning while preserving the server error", async () => {
  renderApp();
  const user = await connect();
  const message = "Unknown column '字段' in 'field list'";
  vi.mocked(invoke).mockRejectedValueOnce({
    message,
    code: "partial_execution",
    sessionLost: false,
    outcomeUnknown: true,
  });
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  await screen.findByRole("alert");
  await chooseLanguage(user, "English");
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain(message);
  expect(alert.textContent).toContain("Earlier statements may have run");
  expect(alert.textContent).toContain(
    "Verify the writes and transaction state",
  );
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  await chooseLanguage(user, "Français");
  expect(alert.textContent).toContain(message);
  expect(alert.textContent).not.toContain("Earlier statements");
  expect(document.documentElement.lang).toBe("fr");
});

it("retranslates in-flight status without restarting the command", async () => {
  renderApp();
  const user = await connect();
  let finish!: (value: QueryResponse) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  const commands = vi.mocked(invoke).mock.calls.length;
  await chooseLanguage(user, "English");
  expect(screen.getByRole("heading", { name: "Executing SQL" })).toBeTruthy();
  expect(invoke).toHaveBeenCalledTimes(commands);
  finish(response(["answer"], [["42"]]));
  await screen.findByText("42");
  expect(screen.getByText("Connected", { exact: true })).toBeTruthy();
});

it("localizes the connection dialog and its browser-only error", async () => {
  localStorage.setItem("mdb.locale", "en");
  vi.mocked(isTauri).mockReturnValue(false);
  renderApp();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "New database connection" }),
  );
  const dialog = screen.getByRole("dialog", { name: "New connection" });
  expect(within(dialog).getByLabelText("Connection name")).toHaveProperty(
    "value",
    "Local MySQL",
  );
  expect(within(dialog).getByLabelText("Password")).toBeTruthy();
  await user.click(
    within(dialog).getByRole("button", { name: "Test connection" }),
  );
  expect((await within(dialog).findByRole("alert")).textContent).toContain(
    "MDB desktop app",
  );
  expect(invoke).not.toHaveBeenCalled();
});

const savedProfile = {
  id: "saved-connection",
  name: "Saved MySQL",
  host: "db.example.test",
  port: 3307,
  username: "alice",
  database: "shop",
  tls: true,
};

function storeSavedProfile() {
  localStorage.setItem("mdb.connections.v1", JSON.stringify([savedProfile]));
}

it("connects a saved profile on double-click with its stored password and no editor", async () => {
  storeSavedProfile();
  renderApp();
  const user = userEvent.setup();
  const item = screen.getByRole("button", {
    name: /^Saved MySQL/,
  });
  await user.click(item);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  await user.dblClick(item);
  await screen.findByRole("button", { name: "shop" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(invoke).toHaveBeenCalledWith("get_password", {
    profileId: savedProfile.id,
  });
  expect(invoke).toHaveBeenCalledWith("connect", {
    config: {
      engine: "mysql",
      host: savedProfile.host,
      port: savedProfile.port,
      username: savedProfile.username,
      database: savedProfile.database,
      tls: savedProfile.tls,
      password: "a@b:/?#%",
    },
  });
  await user.dblClick(item);
  expect(
    vi.mocked(invoke).mock.calls.filter(([command]) => command === "connect"),
  ).toHaveLength(1);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "save_password"),
  ).toBe(false);
});

it("uses an empty password for an older profile and supports keyboard connection", async () => {
  storeSavedProfile();
  vi.mocked(invoke).mockResolvedValueOnce(null);
  renderApp();
  const user = userEvent.setup();
  const item = screen.getByRole("button", {
    name: /^Saved MySQL/,
  });
  item.focus();
  await user.keyboard("{Enter}");
  await screen.findByRole("button", { name: "shop" });
  expect(invoke).toHaveBeenCalledWith("connect", {
    config: expect.objectContaining({ password: "" }),
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("loads the saved password for editing, persists changes, and removes it on deletion", async () => {
  storeSavedProfile();
  renderApp();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "编辑连接 Saved MySQL" }),
  );
  const password = await screen.findByLabelText("密码", { exact: true });
  expect(password).toHaveProperty("value", "a@b:/?#%");
  await user.clear(password);
  await user.type(password, "updated-test-password");
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  await screen.findByRole("button", { name: "shop" });
  expect(invoke).toHaveBeenCalledWith("save_password", {
    profileId: savedProfile.id,
    password: "updated-test-password",
  });
  expect(localStorage.getItem("mdb.connections.v1")).not.toContain(
    "updated-test-password",
  );
  await user.click(screen.getByRole("button", { name: "断开连接" }));
  await user.click(
    screen.getByRole("button", { name: "编辑连接 Saved MySQL" }),
  );
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("button", { name: "删除连接" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(invoke).toHaveBeenCalledWith("delete_password", {
    profileId: savedProfile.id,
  });
  expect(JSON.parse(localStorage.getItem("mdb.connections.v1")!)).toEqual([]);
});

it("does not connect or silently use an empty password when credential retrieval fails", async () => {
  storeSavedProfile();
  renderApp();
  vi.mocked(invoke).mockRejectedValueOnce({
    message: "Credential access failed",
    code: "credential_access",
  });
  await userEvent
    .setup()
    .dblClick(screen.getByRole("button", { name: /^Saved MySQL/ }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "系统凭据库",
  );
  expect(
    vi.mocked(invoke).mock.calls.some(([command]) => command === "connect"),
  ).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(JSON.parse(localStorage.getItem("mdb.connections.v1")!)).toEqual([
    savedProfile,
  ]);
});

it("retains the form and password when credential saving fails", async () => {
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新建数据库连接" }));
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "test-only-password",
  );
  vi.mocked(invoke).mockRejectedValueOnce({
    message: "Credential access failed",
    code: "credential_access",
  });
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  await within(screen.getByRole("dialog")).findByRole("alert");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveProperty(
    "value",
    "test-only-password",
  );
  expect(
    vi.mocked(invoke).mock.calls.some(([command]) => command === "connect"),
  ).toBe(false);
  expect(localStorage.getItem("mdb.connections.v1")).toBeNull();
});

it("keeps the profile available for retry if deleting the credential fails", async () => {
  storeSavedProfile();
  renderApp();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "编辑连接 Saved MySQL" }),
  );
  await screen.findByRole("dialog");
  vi.mocked(invoke).mockRejectedValueOnce({
    message: "Credential access failed",
    code: "credential_access",
  });
  await user.click(screen.getByRole("button", { name: "删除连接" }));
  await within(screen.getByRole("dialog")).findByRole("alert");
  expect(JSON.parse(localStorage.getItem("mdb.connections.v1")!)).toEqual([
    savedProfile,
  ]);
});

const sqliteProfile = {
  id: "sqlite-1",
  name: "本地 SQLite",
  engine: "sqlite",
  path: "/tmp/mdb-ui-test.sqlite",
};

function mockSqlite() {
  const mysql = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (command) {
      case "pick_sqlite_file":
        return sqliteProfile.path;
      case "connect":
        if (
          (args as { config?: { engine: string } } | undefined)?.config
            ?.engine === "sqlite"
        )
          return {
            sessionId: "sqlite-session",
            version: "3.52.0",
            database: "main",
          };
        return mysql(command, args);
      case "test_connection":
        return "3.52.0";
      case "list_databases":
        return response(["Database"], [["main"]], "main");
      case "list_tables":
        return response(
          ["name", "kind", "engine", "rows", "comment"],
          [["items", "BASE TABLE", "SQLite", null, null]],
          "main",
        );
      case "browse_table":
        return response(
          ["id", "note"],
          [["9223372036854775807", null]],
          "main",
        );
      case "table_structure":
        return response(
          ["name", "type", "pk"],
          [["id", "INTEGER", "1"]],
          "main",
        );
      case "execute_query":
        return response(["version"], [["3.52.0"]], "main");
      case "get_password":
      case "save_password":
      case "delete_password":
        throw new Error("SQLite must not access credentials");
      default:
        return mysql(command, args);
    }
  });
}

it("creates a SQLite file connection, tests it and browses schemas/data without MySQL credentials", async () => {
  mockSqlite();
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新建数据库连接" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "数据库类型" }),
    "sqlite",
  );
  expect(screen.queryByLabelText("主机", { exact: true })).toBeNull();
  expect(screen.queryByLabelText("密码", { exact: true })).toBeNull();
  expect(screen.getByLabelText("连接名称")).toHaveProperty(
    "value",
    "本地 SQLite",
  );
  await user.click(screen.getByRole("button", { name: "选择数据库文件" }));
  expect(screen.getByLabelText("SQLite 数据库文件")).toHaveProperty(
    "value",
    sqliteProfile.path,
  );
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText("连接成功 · SQLite 3.52.0");
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  await screen.findByRole("button", { name: "items" });
  expect(invoke).toHaveBeenCalledWith("connect", {
    config: { engine: "sqlite", path: sqliteProfile.path },
  });
  const saved = JSON.parse(localStorage.getItem("mdb.connections.v1")!)[0];
  expect(saved).toEqual({ ...sqliteProfile, id: expect.any(String) });
  expect(screen.getByText("SQLite 3.52.0")).toBeTruthy();
  expect(screen.queryByText("TLS 已启用")).toBeNull();
  expect(screen.getByRole("textbox", { name: "SQL 查询" })).toHaveProperty(
    "value",
    "SELECT sqlite_version() AS version;",
  );
  await user.click(screen.getByRole("button", { name: "items" }));
  expect(await screen.findByText("9223372036854775807")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "表结构" }));
  await screen.findByText("INTEGER");
  await user.click(screen.getByRole("button", { name: "SQL 查询" }));
  await user.click(screen.getByRole("button", { name: /运行 SQL/ }));
  await screen.findByText("3.52.0");
  expect(invoke).toHaveBeenCalledWith("execute_query", {
    sessionId: "sqlite-session",
    database: "main",
    sql: "SELECT sqlite_version() AS version;",
  });
});

it("double-clicks, edits and deletes a saved SQLite profile without a credential store", async () => {
  mockSqlite();
  localStorage.setItem("mdb.connections.v1", JSON.stringify([sqliteProfile]));
  renderApp();
  const user = userEvent.setup();
  await user.dblClick(screen.getByRole("button", { name: /^本地 SQLite/ }));
  await screen.findByRole("button", { name: "items" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: "断开连接" }));
  await user.click(
    screen.getByRole("button", { name: "编辑连接 本地 SQLite" }),
  );
  expect(screen.getByLabelText("SQLite 数据库文件")).toHaveProperty(
    "value",
    sqliteProfile.path,
  );
  expect(screen.getByRole("combobox", { name: "数据库类型" })).toHaveProperty(
    "disabled",
    true,
  );
  await user.click(screen.getByRole("button", { name: "删除连接" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(JSON.parse(localStorage.getItem("mdb.connections.v1")!)).toEqual([]);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command.endsWith("_password")),
  ).toBe(false);
});

it("keeps the SQLite path on picker cancellation and preserves a custom name when changing type", async () => {
  mockSqlite();
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新建数据库连接" }));
  const name = screen.getByLabelText("连接名称");
  await user.clear(name);
  await user.type(name, "Custom database");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "数据库类型" }),
    "sqlite",
  );
  expect(name).toHaveProperty("value", "Custom database");
  await user.type(
    screen.getByLabelText("SQLite 数据库文件"),
    sqliteProfile.path,
  );
  vi.mocked(invoke).mockResolvedValueOnce(null);
  await user.click(screen.getByRole("button", { name: "选择数据库文件" }));
  expect(screen.getByLabelText("SQLite 数据库文件")).toHaveProperty(
    "value",
    sqliteProfile.path,
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "数据库类型" }),
    "mysql",
  );
  expect(screen.getByLabelText("主机", { exact: true })).toHaveProperty(
    "value",
    "127.0.0.1",
  );
});

it("retains the MySQL connection and SQL draft when opening SQLite fails", async () => {
  renderApp();
  const user = await connect();
  const draft = "SELECT 'keep my draft';";
  fireEvent.change(screen.getByRole("textbox", { name: "SQL 查询" }), {
    target: { value: draft },
  });
  await user.click(
    within(screen.getByRole("banner")).getByRole("button", {
      name: "新建连接",
    }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "数据库类型" }),
    "sqlite",
  );
  await user.type(
    screen.getByLabelText("SQLite 数据库文件"),
    "/missing/database.sqlite",
  );
  vi.mocked(invoke).mockRejectedValueOnce({
    message: "Invalid file",
    code: "invalid_sqlite_file",
  });
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  await within(screen.getByRole("dialog")).findByRole("alert");
  await user.click(screen.getByRole("button", { name: "关闭连接设置" }));
  expect(screen.getByRole("textbox", { name: "SQL 查询" })).toHaveProperty(
    "value",
    draft,
  );
  expect(screen.getByText("MySQL 8.4.0")).toBeTruthy();
  expect(screen.getByRole("button", { name: "断开连接" })).toBeTruthy();
});


it("reconnects an edited active profile after the new target failed", async () => {
  storeSavedProfile();
  renderApp();
  const user = userEvent.setup();
  await user.dblClick(screen.getByRole("button", { name: /^Saved MySQL/ }));
  await screen.findByRole("button", { name: "shop" });
  await user.click(screen.getByRole("button", { name: "编辑连接 Saved MySQL" }));
  const host = await screen.findByLabelText("主机", { exact: true });
  await user.clear(host);
  await user.type(host, "other-db.example.test");
  const delegate = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "connect") throw { message: "Cannot open edited target", sessionLost: false };
    return delegate(command, args);
  });
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  await within(screen.getByRole("dialog")).findByRole("alert");
  await user.click(screen.getByRole("button", { name: "关闭连接设置" }));
  const edited = screen.getByRole("button", { name: /^Saved MySQL/ });
  expect(edited.textContent).toContain("other-db.example.test");
  expect(edited.className).not.toContain("connected");
  expect(within(screen.getByRole("banner")).getByText("alice@db.example.test:3307")).toBeTruthy();
  const before = vi.mocked(invoke).mock.calls.filter(([command]) => command === "connect").length;
  await user.dblClick(edited);
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "connect")).toHaveLength(before + 1));
  expect(invoke).toHaveBeenLastCalledWith("connect", { config: expect.objectContaining({ host: "other-db.example.test" }) });
});

it.each(["save", "delete"])("keeps credentials untouched when metadata %s fails", async (operation) => {
  storeSavedProfile();
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "编辑连接 Saved MySQL" }));
  await screen.findByRole("dialog");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "QuotaExceededError");
  });
  await user.click(screen.getByRole("button", { name: operation === "save" ? "保存并连接" : "删除连接" }));
  await within(screen.getByRole("dialog")).findByRole("alert");
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "save_password" || command === "delete_password" || command === "connect")).toBe(false);
  expect(JSON.parse(localStorage.getItem("mdb.connections.v1")!)).toEqual([savedProfile]);
});

it("reports failed metadata recovery after a credential error", async () => {
  storeSavedProfile();
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "编辑连接 Saved MySQL" }));
  await screen.findByRole("dialog");
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(setItem).mockImplementation(() => {
    throw new DOMException("Storage unavailable", "QuotaExceededError");
  });
  vi.mocked(invoke).mockRejectedValueOnce({ code: "credential_access", message: "Credential unavailable" });
  await user.click(screen.getByRole("button", { name: "保存并连接" }));
  const alert = await within(screen.getByRole("dialog")).findByRole("alert");
  expect(alert.textContent).toContain("恢复连接配置失败");
});

it("shows SQLite name-resolution guidance for the selected attached schema", async () => {
  mockSqlite();
  localStorage.setItem("mdb.connections.v1", JSON.stringify([sqliteProfile]));
  const delegate = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_databases") return response(["Database"], [["main"], ["extra"]], "main");
    return delegate(command, args);
  });
  renderApp();
  const user = userEvent.setup();
  await user.dblClick(screen.getByRole("button", { name: /^本地 SQLite/ }));
  await user.click(await screen.findByRole("button", { name: "extra" }));
  expect(await screen.findByText(/浏览 extra 不会改变未限定表名/)).toBeTruthy();
  expect(screen.queryByText("extra", {selector: ".tabs-context"})).toBeNull();
});
