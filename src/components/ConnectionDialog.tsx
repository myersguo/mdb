import { useEffect, useRef, useState } from "react";
import { Database, LoaderCircle, ShieldCheck, X } from "lucide-react";
import {
  call,
  databaseError,
  formatDatabaseError,
  type ConnectionConfig,
  type ConnectionProfile,
  type DatabaseError,
  type Engine,
} from "../lib/db";
import { t, useLocale } from "../i18n";

interface Props {
  profile: ConnectionProfile | null;
  active: boolean;
  busy: boolean;
  error: DatabaseError | null;
  initialPassword?: string;
  onClose: () => void;
  onConnect: (
    profile: ConnectionProfile,
    config: ConnectionConfig,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function ConnectionDialog({
  profile,
  active,
  busy,
  error,
  initialPassword = "",
  onClose,
  onConnect,
  onDelete,
}: Props) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const mysql = profile?.engine === "mysql" ? profile : null;
  const [engine, setEngine] = useState<Engine>(profile?.engine ?? "mysql");
  const [path, setPath] = useState(
    profile?.engine === "sqlite" ? profile.path : "",
  );
  const [form, setForm] = useState({
    id: profile?.id ?? crypto.randomUUID(),
    name: profile?.name ?? t("connection.defaultName"),
    host: mysql?.host ?? "127.0.0.1",
    port: mysql?.port ?? 3306,
    username: mysql?.username ?? "root",
    database: mysql?.database ?? "",
    tls: mysql?.tls ?? true,
  });
  const [password, setPassword] = useState(initialPassword);
  const [testing, setTesting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; version: string } | { ok: false; error: DatabaseError } | null
  >(null);
  const locked = busy || testing || picking;

  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.focus();
  }, []);

  const config = (): ConnectionConfig =>
    engine === "sqlite"
      ? { engine, path }
      : {
          engine: "mysql",
          host: form.host.trim(),
          port: form.port,
          username: form.username,
          password,
          database: form.database.trim(),
          tls: form.tls,
        };
  const change = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setTestResult(null);
  };

  async function pickFile() {
    setPicking(true);
    try {
      const selected = await call<string | null>("pick_sqlite_file", {
        title: t("connection.selectFile"),
      });
      if (selected !== null) {
        setPath(selected);
        setTestResult(null);
      }
    } catch (error) {
      setTestResult({ ok: false, error: databaseError(error) });
    } finally {
      setPicking(false);
    }
  }

  async function test() {
    const element = dialog.current?.querySelector("form");
    if (!element?.reportValidity()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const version = await call<string>("test_connection", {
        config: config(),
      });
      setTestResult({ ok: true, version });
    } catch (error) {
      setTestResult({ ok: false, error: databaseError(error) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="connection-dialog"
      aria-labelledby="connection-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setTestResult(null);
          if (!locked)
            void onConnect(
              engine === "sqlite"
                ? { id: form.id, name: form.name.trim(), engine, path }
                : {
                    ...form,
                    engine: "mysql",
                    name: form.name.trim(),
                    host: form.host.trim(),
                    database: form.database.trim(),
                  },
              config(),
            );
        }}
      >
        <div className="dialog-heading">
          <div className="dialog-symbol">
            <Database size={22} />
          </div>
          <div>
            <h2 id="connection-title">
              {t(profile ? "connection.settings" : "nav.newConnection")}
            </h2>
            <p>{t("connection.subtitle")}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("connection.close")}
            disabled={locked}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <fieldset disabled={locked}>
          <label>
            {t("connection.engine")}
            <select
              value={engine}
              disabled={profile !== null}
              onChange={(event) => {
                const next = event.target.value as Engine;
                if (
                  form.name ===
                  t(
                    engine === "mysql"
                      ? "connection.defaultName"
                      : "connection.sqliteDefaultName",
                  )
                ) {
                  change({
                    name: t(
                      next === "mysql"
                        ? "connection.defaultName"
                        : "connection.sqliteDefaultName",
                    ),
                  });
                }
                setEngine(next);
                setTestResult(null);
              }}
            >
              <option value="mysql">MySQL</option>
              <option value="sqlite">SQLite</option>
            </select>
          </label>
          <label>
            {t("connection.name")}
            <input
              autoFocus
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => change({ name: e.target.value })}
            />
          </label>
          {engine === "sqlite" ? (
            <>
              <label>
                {t("connection.sqliteFile")}
                <input
                  required
                  value={path}
                  placeholder={t("connection.sqlitePathPlaceholder")}
                  spellCheck={false}
                  onChange={(event) => {
                    setPath(event.target.value);
                    setTestResult(null);
                  }}
                />
              </label>
              <button
                type="button"
                className="button"
                onClick={() => void pickFile()}
              >
                {picking && <LoaderCircle size={15} className="spin" />}
                {t("connection.selectFile")}
              </button>
              <p className="form-note">{t("connection.sqliteNote")}</p>
            </>
          ) : (
            <>
              <div className="form-row host-row">
                <label>
                  {t("connection.host")}
                  <input
                    required
                    value={form.host}
                    onChange={(e) => change({ host: e.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label>
                  {t("connection.port")}
                  <input
                    required
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port || ""}
                    onChange={(e) => change({ port: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  {t("connection.username")}
                  <input
                    required
                    value={form.username}
                    onChange={(e) => change({ username: e.target.value })}
                    autoComplete="off"
                  />
                </label>
                <label>
                  {t("connection.password")}
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setTestResult(null);
                    }}
                    autoComplete="off"
                    placeholder={t("connection.passwordPlaceholder")}
                  />
                </label>
              </div>
              <label>
                {t("connection.database")}{" "}
                <span className="muted">{t("connection.optional")}</span>
                <input
                  value={form.database}
                  onChange={(e) => change({ database: e.target.value })}
                  placeholder={t("connection.databasePlaceholder")}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.tls}
                  onChange={(e) => change({ tls: e.target.checked })}
                />
                <ShieldCheck size={17} />
                <span>{t("connection.tls")}</span>
              </label>
              <p className="form-note">{t("connection.privacy")}</p>
            </>
          )}
        </fieldset>
        {(error || testResult) && (
          <div
            role={testResult?.ok ? "status" : "alert"}
            className={`dialog-message ${testResult?.ok ? "success" : "error"}`}
          >
            {testResult
              ? testResult.ok
                ? t("connection.testSuccess", {
                    version: testResult.version,
                    engine: engine === "sqlite" ? "SQLite" : "MySQL",
                  })
                : formatDatabaseError(testResult.error)
              : error && formatDatabaseError(error)}
          </div>
        )}
        <footer className="dialog-footer">
          {profile && (
            <button
              type="button"
              className="danger-text"
              disabled={locked || active}
              title={t(
                active ? "connection.disconnectFirst" : "connection.deleteHint",
              )}
              onClick={() => void onDelete(profile.id)}
            >
              {t("connection.delete")}
            </button>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              disabled={locked}
              onClick={() => void test()}
            >
              {testing && <LoaderCircle size={15} className="spin" />}
              {t("connection.test")}
            </button>
            <button type="submit" className="button primary" disabled={locked}>
              {busy && <LoaderCircle size={15} className="spin" />}
              {t("connection.save")}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
