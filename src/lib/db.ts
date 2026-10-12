import { invoke, isTauri } from "@tauri-apps/api/core";
import { t, type MessageKey } from "../i18n";

export interface MySqlProfile {
  id: string;
  name: string;
  engine: "mysql";
  host: string;
  port: number;
  username: string;
  database: string;
  tls: boolean;
}

export interface SqliteProfile {
  id: string;
  name: string;
  engine: "sqlite";
  path: string;
}
export type ConnectionProfile = MySqlProfile | SqliteProfile;
export type Engine = ConnectionProfile["engine"];

export interface MySqlConfig extends Omit<MySqlProfile, "id" | "name"> {
  password: string;
}
export type ConnectionConfig =
  MySqlConfig | Pick<SqliteProfile, "engine" | "path">;

export interface Session {
  sessionId: string;
  version: string;
  database: string | null;
}

export interface ResultSet {
  columns: { name: string; dataType: string }[];
  rows: (string | null)[][];
  affectedRows: string;
  truncated: boolean;
}

export interface QueryResponse {
  sets: ResultSet[];
  elapsedMs: number;
  database: string | null;
  setsTruncated: boolean;
  hasMore: boolean;
}

export interface DatabaseError {
  message: string;
  code?: ErrorCode;
  sessionLost: boolean;
  outcomeUnknown: boolean;
}

const errorMessages = {
  invalid_identifier: "error.invalidIdentifier",
  invalid_connection: "error.invalidConnection",
  connect_timeout: "error.connectTimeout",
  close_timeout: "error.closeTimeout",
  disconnect_timeout: "error.disconnectTimeout",
  invalid_sql: "error.invalidSQL",
  session_expired: "error.sessionExpired",
  query_timeout: "error.queryTimeout",
  partial_execution: "error.partialExecution",
  invalid_profiles: "error.invalidProfiles",
  desktop_required: "error.desktopRequired",
  required_fields: "error.requiredFields",
  credential_access: "error.credentialAccess",
  profile_restore_failed: "error.profileRestore",
  invalid_sqlite_file: "error.invalidSqliteFile",
  sqlite_timeout: "error.sqliteTimeout",
  database_task_failed: "error.databaseTaskFailed",
} satisfies Record<string, MessageKey>;
type ErrorCode = keyof typeof errorMessages;

export function appError(code: ErrorCode): Error & { code: ErrorCode } {
  return Object.assign(new Error(code), { code });
}

export function formatDatabaseError(error: DatabaseError): string {
  const explanation = error.code ? t(errorMessages[error.code]) : error.message;
  const message =
    error.code === "partial_execution"
      ? `${error.message} ${explanation}`
      : explanation;
  return error.outcomeUnknown &&
    error.code !== "query_timeout" &&
    error.code !== "sqlite_timeout" &&
    error.code !== "partial_execution"
    ? `${message} ${t("error.outcomeUnknown")}`
    : message;
}

export function databaseError(error: unknown): DatabaseError {
  if (typeof error === "object" && error !== null && "message" in error) {
    return {
      message: String(error.message),
      code:
        "code" in error &&
        typeof error.code === "string" &&
        Object.prototype.hasOwnProperty.call(errorMessages, error.code)
          ? (error.code as ErrorCode)
          : undefined,
      sessionLost: "sessionLost" in error && error.sessionLost === true,
      outcomeUnknown:
        "outcomeUnknown" in error && error.outcomeUnknown === true,
    };
  }
  return { message: String(error), sessionLost: false, outcomeUnknown: false };
}

export async function call<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) throw appError("desktop_required");
  return invoke<T>(command, args);
}

export function quoteIdentifier(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}

const STORAGE_KEY = "mdb.connections.v1";

type StoredProfile =
  (Omit<MySqlProfile, "engine"> & { engine?: "mysql" }) | SqliteProfile;

function metadata(profile: StoredProfile): ConnectionProfile {
  if (profile.engine === "sqlite") {
    return {
      id: profile.id,
      name: profile.name,
      engine: "sqlite",
      path: profile.path,
    };
  }
  return {
    id: profile.id,
    name: profile.name,
    engine: "mysql",
    host: profile.host,
    port: profile.port,
    username: profile.username,
    database: profile.database,
    tls: profile.tls,
  };
}

function validProfile(value: unknown): value is StoredProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.name !== "string") return false;
  if (p.engine === "sqlite") return typeof p.path === "string";
  if (p.engine !== undefined && p.engine !== "mysql") return false;
  return (
    ["id", "name", "host", "username", "database"].every(
      (key) => typeof p[key] === "string",
    ) &&
    typeof p.port === "number" &&
    Number.isInteger(p.port) &&
    p.port > 0 &&
    p.port <= 65535 &&
    typeof p.tls === "boolean"
  );
}

export function loadProfiles(): ConnectionProfile[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];
  const profiles: unknown = JSON.parse(stored);
  if (
    !Array.isArray(profiles) ||
    !profiles.every(validProfile) ||
    new Set(profiles.map((p) => p.id)).size !== profiles.length
  ) {
    throw appError("invalid_profiles");
  }
  return profiles.map(metadata);
}

export function saveProfiles(profiles: ConnectionProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles.map(metadata)));
}

export async function persistProfiles(
  profiles: ConnectionProfile[],
  updateCredential?: () => Promise<unknown>,
): Promise<void> {
  // ponytail: Command failures are recoverable; crash-safe cross-store saves need a native journal.
  const previous = localStorage.getItem(STORAGE_KEY);
  saveProfiles(profiles);
  try {
    await updateCredential?.();
  } catch (error) {
    try {
      if (previous === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, previous);
    } catch {
      throw appError("profile_restore_failed");
    }
    throw error;
  }
}
