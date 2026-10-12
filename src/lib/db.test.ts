import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  call,
  databaseError,
  formatDatabaseError,
  loadProfiles,
  quoteIdentifier,
  saveProfiles,
  type ConnectionProfile,
} from "./db";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const profile: ConnectionProfile = {
  id: "local",
  engine: "mysql",
  name: "Local",
  host: "localhost",
  port: 3306,
  username: "root",
  database: "",
  tls: true,
};

beforeEach(() => vi.clearAllMocks());

describe("connection persistence", () => {
  it("never serializes a password even if a caller supplies one", () => {
    saveProfiles([
      {
        ...profile,
        password: "secret",
        unknown: "untrusted",
      } as ConnectionProfile,
    ]);
    const raw = localStorage.getItem("mdb.connections.v1")!;
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("unknown");
    expect(loadProfiles()).toEqual([profile]);
  });

  it("rejects damaged and duplicate profiles without overwriting the source", () => {
    for (const raw of [
      "not json",
      JSON.stringify([{ ...profile, port: -1 }]),
      JSON.stringify([profile, profile]),
    ]) {
      localStorage.setItem("mdb.connections.v1", raw);
      expect(() => loadProfiles()).toThrow();
      expect(localStorage.getItem("mdb.connections.v1")).toBe(raw);
    }
  });

  it("loads only whitelisted connection metadata", () => {
    localStorage.setItem(
      "mdb.connections.v1",
      JSON.stringify([{ ...profile, password: "old" }]),
    );
    expect(loadProfiles()).toEqual([profile]);
  });
});

it("escapes identifier quotes", () => {
  expect(quoteIdentifier("orders`archive")).toBe("`orders``archive`");
});

it("does not invoke database commands in a browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await expect(call("connect", {})).rejects.toMatchObject({
    code: "desktop_required",
  });
  expect(invoke).not.toHaveBeenCalled();
});

it("preserves server errors and ignores unknown or inherited error codes", () => {
  for (const code of [null, "ER_BAD_FIELD_ERROR", "toString", "__proto__"]) {
    const error = databaseError({ message: "Unknown column '字段'", code });
    expect(error.code).toBeUndefined();
    expect(formatDatabaseError(error)).toBe("Unknown column '字段'");
  }
  expect(
    databaseError({
      message: "fallback",
      code: "query_timeout",
      sessionLost: true,
      outcomeUnknown: true,
    }),
  ).toEqual({
    message: "fallback",
    code: "query_timeout",
    sessionLost: true,
    outcomeUnknown: true,
  });
});

it("loads legacy MySQL and SQLite profiles without losing IDs or writing the source", () => {
  const { engine: _engine, ...legacy } = profile;
  const sqlite = {
    id: "sqlite",
    engine: "sqlite",
    name: "Local SQLite",
    path: "/tmp/example.sqlite",
  };
  const raw = JSON.stringify([legacy, sqlite]);
  localStorage.setItem("mdb.connections.v1", raw);
  expect(loadProfiles()).toEqual([profile, sqlite]);
  expect(localStorage.getItem("mdb.connections.v1")).toBe(raw);
  saveProfiles([
    profile,
    { ...sqlite, engine: "sqlite", password: "untrusted" } as ConnectionProfile,
  ]);
  expect(localStorage.getItem("mdb.connections.v1")).not.toContain("untrusted");
});

it("rejects unsupported engines and incomplete SQLite profiles", () => {
  for (const bad of [
    { ...profile, engine: "unknown" },
    { id: "s", name: "SQLite", engine: "sqlite" },
    { id: "s", name: "SQLite", engine: "sqlite", path: 1 },
  ]) {
    localStorage.setItem("mdb.connections.v1", JSON.stringify([bad]));
    expect(() => loadProfiles()).toThrow();
  }
});
