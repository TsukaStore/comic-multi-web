import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { config } from "../config.ts";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, "app.db");
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_accounts (
      source_key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorite_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      comic_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cover TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      added_at INTEGER NOT NULL,
      UNIQUE(source_key, comic_id, folder_id)
    );

    CREATE TABLE IF NOT EXISTS history (
      source_key TEXT NOT NULL,
      comic_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cover TEXT NOT NULL,
      ep TEXT NOT NULL DEFAULT '',
      page INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_key, comic_id)
    );

    CREATE TABLE IF NOT EXISTS search_history (
      keyword TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      comic_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cover TEXT NOT NULL DEFAULT '',
      ep TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      path TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const folder = database
    .prepare("SELECT id FROM favorite_folders WHERE id = ?")
    .get("default") as { id: string } | undefined;
  if (!folder) {
    database
      .prepare(
        "INSERT INTO favorite_folders (id, name, order_index) VALUES (?, ?, ?)",
      )
      .run("default", "默认", 0);
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb()
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(key, JSON.stringify(value));
}

export function getSourceAccount(sourceKey: string): Record<string, unknown> | null {
  const row = getDb()
    .prepare("SELECT data_json FROM source_accounts WHERE source_key = ?")
    .get(sourceKey) as { data_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function setSourceAccount(sourceKey: string, data: Record<string, unknown>) {
  getDb()
    .prepare(
      `INSERT INTO source_accounts (source_key, data_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
    )
    .run(sourceKey, JSON.stringify(data), Date.now());
}

export function clearSourceAccount(sourceKey: string) {
  getDb().prepare("DELETE FROM source_accounts WHERE source_key = ?").run(sourceKey);
}
