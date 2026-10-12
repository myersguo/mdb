# MDB

[English](README.md) | [简体中文](README.zh-CN.md)

一个使用 TypeScript、React 和 Tauri 2 构建的数据库桌面客户端，支持 MySQL 和 SQLite。Rust 分别通过 `mysql_async` 与 `rusqlite` 连接数据库，前端通过 Tauri IPC 调用。

## 当前能力

- 保存、编辑和删除连接配置；测试连接；连接与断开。
- 新建连接时选择 MySQL 或 SQLite。SQLite 可通过本机文件选择器或绝对路径打开已有数据库文件，支持表、视图、字段浏览及 SQL 读写。
- 默认将密码保存在本机系统凭据库。已保存连接可双击连接，也可聚焦后按 Enter / Space；旁边的编辑按钮用于修改配置与密码。
- 浏览账号可访问的数据库和表，按表名或注释筛选。
- 浏览表数据，每页 100 行；有主键时按主键排序。
- 查看字段、类型、默认值、索引标记和注释。
- 执行 SQL，支持选区执行和 ⌘ / Ctrl + Enter。
- 展示多个结果集、重复列名、NULL、二进制十六进制值；MySQL BIGINT/DECIMAL 和 SQLite 整数以字符串保留精度。SQLite REAL 展示数据库已存储的浮点值，声明为 DECIMAL 不会改变 SQLite 自身的类型语义。
- 支持英文、简体中文、繁体中文、日文、韩文、西班牙文和法文。侧栏底部可切换语言，首次按系统语言初始化，之后使用保存的选择（`mdb.locale`）；切换保留活动连接、SQL 草稿和结果。

多语言沿用 AGM 的类型化词典约定：英文词典定义键，其他语言在编译时检查完整性。界面、帮助、状态和 MDB 自身错误随语言切换；连接名称、数据库标识符、SQL、数据值及服务器原始错误保持原文。

当前只有一个活动连接。MySQL 用户 SQL 使用文本协议，支持 SQL 脚本与存储过程；`DELIMITER` 是 mysql 命令行指令，执行存储过程定义时无需添加它。SQLite 脚本由数据库原生解析，支持含分号的字符串与触发器。元数据使用参数绑定或标识符转义。

SQL 按所连接数据库的权限执行，写入和 DDL 直接作用于数据库。应用不会为脚本自动包裹事务；出错后应核实写入与事务状态，具体回滚遵循数据库和 SQL 的事务语义。

## 开发

需要 Node.js 22.12+、Rust stable，以及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。本机已验证 Node.js 24、Rust 1.92 和 macOS arm64。

```bash
npm ci
npm run tauri dev
```

`npm run dev` 仅启动浏览器界面预览；数据库连接需要桌面运行环境。

macOS App 构建：

```bash
npm run build:app
```

产物：`src-tauri/target/release/bundle/macos/MDB.app`。应用包使用 ad-hoc 签名，尚未配置 Developer ID 签名或公证。其他平台可使用 `npm run tauri build`，尚未验证 Windows/Linux 构建。

## 验证

```bash
npm run typecheck
npm test
npm run test:rust
npm run test:mysql
npm run test:credentials
```

`test:mysql` 需要 PATH 中有 `mysql`、`mysqld` 和 Python 3。脚本启动独立的临时 MySQL、随机 loopback 端口，运行真实数据库集成测试，并在退出时关闭子进程、删除临时目录。不会连接本机已有实例。测试覆盖真实数据类型、读写、标识符转义、分页、结果上限、错误恢复、存储过程、多结果集、脚本部分执行、会话切换与 30 秒超时。

`test:rust` 自动执行 SQLite 真实引擎测试，使用单连接内存库和临时文件，覆盖文件持久化、类型值、元数据、分页、触发器、`RETURNING`、显示上限、部分执行、超时及连接切换后的事务回滚。`test:mysql` 还验证 MySQL → SQLite → MySQL 的切换和旧会话失效。

`test:credentials` 使用唯一测试条目，验证系统凭据库的密码保存、读取、更新为空密码和删除，并清理该条目。已验证 macOS Keychain；Windows Credential Manager 和 Linux Secret Service 的运行环境尚未验证。Linux 需要可用且已解锁的 Secret Service。

手动测试界面：

```bash
python3 scripts/test-mysql.py --serve
```

脚本创建 `mdb_demo.orders` 样例表并输出随机端口。使用 `127.0.0.1`、用户 `root`、空密码、数据库 `mdb_demo`，关闭 TLS 后连接。终端按 Enter 停止并清理测试服务器。

## 数据与会话边界

- 连接名称、数据库类型及配置保存在 WebView 的 `localStorage`（`mdb.connections.v1`）。旧 MySQL 配置自动识别为 MySQL，保留连接 ID 和原有凭据。MySQL 密码由 Rust 通过 `keyring` 保存在系统凭据库，以应用服务名 `com.myersguo.mdb` 和连接 ID 标识；配置 JSON 不包含密码。SQLite 只保存文件路径，不访问密码凭据库。删除 SQLite 连接仅移除连接配置，数据库文件保留。
- 配置写入失败时不会修改凭据；凭据操作失败时恢复原始配置，并保留表单供重试。配置与系统凭据属于两个存储，进程中途终止时不具备跨存储事务保证。
- MySQL 默认启用 TLS 并校验服务器证书。首版使用公开信任根，暂不支持自定义 CA、客户端证书或 SSH 隧道。本机测试服务可以关闭 TLS。
- MySQL 连接超时 10 秒，查询超时 30 秒。超时或协议失效时关闭会话，不自动重试；服务器可能已经执行写入，界面会提示结果不确定。
- SQLite 使用打包的数据库引擎，打开已有标准 SQLite 文件，不会因路径输入错误自动创建新库。以读写方式打开，默认启用外键检查，锁等待最多 5 秒。工作在后台线程；SQL 使用 30 秒 VM 进度回调中断，底层文件系统调用依赖系统响应。超时后关闭会话；脚本前面已提交的写入可能保留。
- 查询显示最多 1,000 行、4 MiB 单元格内容、20 个结果集。达到上限会明确提示结果不完整；SQL 不会被自动追加 LIMIT。完整导出需要后续流式处理能力。
- 切换或断开连接会结束当前会话，未提交事务随连接关闭回滚。MySQL 权限由数据库账号控制，SQLite 权限由本机文件系统控制。SQLite 不提供 `USE`，浏览树选择不会改变 SQL 的名称解析；编辑器会明确提示，SQL 中访问附加数据库应显式限定模式名（如 `extra.items`）。
- 无主键表与并发修改下的 OFFSET 翻页不保证稳定；需要可复现顺序时使用 SQL 指定 ORDER BY。

导入导出、数据网格编辑、图形化建表、多连接并行、查询历史和 SQL 自动补全尚未实现。

## 主要入口

- `src/App.tsx`：连接、导航、编辑器与结果状态。
- `src/components/`：连接表单、结果网格。
- `src/i18n.tsx`、`src/locales/`：语言解析、选择持久化、翻译和七套词典。
- `src/lib/db.ts`：IPC 数据契约和连接配置持久化。
- `src-tauri/src/lib.rs`：Tauri 命令注册。
- `src-tauri/src/db.rs`：MySQL 会话、数据转换、结果限制和集成测试。
- `src-tauri/src/connections.rs`：单活动连接、数据库类型分发及会话 ID 校验。
- `src-tauri/src/sqlite.rs`：SQLite 文件连接、脚本执行、元数据、结果限制和真实引擎测试。
- `src-tauri/src/passwords.rs`：系统凭据库中的连接密码及独立往返验证。

框架配置参考 [Tauri 的 Vite 集成文档](https://v2.tauri.app/start/frontend/vite/)；数据库驱动参考 [mysql_async 文档](https://docs.rs/mysql_async/0.37.1/mysql_async/) 和 [rusqlite 文档](https://docs.rs/rusqlite/0.40.2/rusqlite/)。本机文件选择器使用 [Tauri Dialog](https://v2.tauri.app/plugin/dialog/)。

## 发布

首版发行范围为 macOS arm64（macOS 11+）。许可证为 [MIT](LICENSE)。

`.github/workflows/ci.yml` 在 main、版本标签和 PR 上运行类型检查、测试、Rust fmt/Clippy、依赖审计与独立 MySQL 集成测试，并构建 arm64 应用。系统凭据往返测试需在本机可用的凭据库运行。CI 生成验证过签名的归档、SHA256SUMS 和 cask，供维护者检查；不自动发布或修改 tap。

本地打包：

```bash
npm run build:app
npm run package:macos
```

`package:macos` 检查三处版本号、应用版本、arm64 架构与完整签名，并解压归档再次校验签名。产物在 `release/`：`MDB-0.1.0-macos-arm64.zip`、`SHA256SUMS`、`mdb.rb`。该目录不会提交到源码仓库。

发布时以同一版本标签上传 ZIP 和 SHA256SUMS 到 [GitHub Releases](https://github.com/myersguo/mdb/releases)，确认下载文件的校验和与 cask 一致后，再将生成的 `mdb.rb` 更新到 [homebrew-tap](https://github.com/myersguo/homebrew-tap)。已发布归档不可原地替换；代码或归档变化应升级版本。

安装：

```bash
brew install --cask myersguo/tap/mdb
```

ad-hoc 签名无法替代公证，首次打开可能需要在 macOS 隐私与安全设置中批准。Windows/Linux 尚未验证，Rust 审计中的 Linux GTK/glib 警告也尚未消除。
