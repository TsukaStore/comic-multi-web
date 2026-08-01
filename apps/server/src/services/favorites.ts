import { randomUUID } from "node:crypto";

import type { FavoriteFolder, FavoriteItem } from "../domain/models.ts";

import { getDb } from "../db/index.ts";

export function listFolders(): FavoriteFolder[] {
  const rows = getDb()
    .prepare("SELECT id, name, order_index FROM favorite_folders ORDER BY order_index, name")
    .all() as { id: string; name: string; order_index: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, orderIndex: r.order_index }));
}

export function createFolder(name: string): FavoriteFolder {
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO favorite_folders (id, name, order_index) VALUES (?, ?, ?)")
    .run(id, name, Date.now());
  return { id, name, orderIndex: Date.now() };
}

export function listFavorites(folderId?: string): FavoriteItem[] {
  const sql = folderId
    ? "SELECT * FROM favorites WHERE folder_id = ? ORDER BY added_at DESC"
    : "SELECT * FROM favorites ORDER BY added_at DESC";
  const rows = (
    folderId ? getDb().prepare(sql).all(folderId) : getDb().prepare(sql).all()
  ) as {
    id: string;
    folder_id: string;
    source_key: string;
    comic_id: string;
    title: string;
    cover: string;
    tags_json: string;
    added_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    folderId: r.folder_id,
    sourceKey: r.source_key,
    comicId: r.comic_id,
    title: r.title,
    cover: r.cover,
    tags: JSON.parse(r.tags_json) as string[],
    addedAt: r.added_at,
  }));
}

export function addFavorite(input: {
  folderId?: string;
  sourceKey: string;
  comicId: string;
  title: string;
  cover: string;
  tags?: string[];
}): FavoriteItem {
  const id = randomUUID();
  const folderId = input.folderId || "default";
  const addedAt = Date.now();
  getDb()
    .prepare(
      `INSERT INTO favorites (id, folder_id, source_key, comic_id, title, cover, tags_json, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_key, comic_id, folder_id) DO UPDATE SET
         title = excluded.title, cover = excluded.cover, tags_json = excluded.tags_json`,
    )
    .run(
      id,
      folderId,
      input.sourceKey,
      input.comicId,
      input.title,
      input.cover,
      JSON.stringify(input.tags ?? []),
      addedAt,
    );
  return {
    id,
    folderId,
    sourceKey: input.sourceKey,
    comicId: input.comicId,
    title: input.title,
    cover: input.cover,
    tags: input.tags ?? [],
    addedAt,
  };
}

export function removeFavorite(sourceKey: string, comicId: string, folderId = "default") {
  getDb()
    .prepare(
      "DELETE FROM favorites WHERE source_key = ? AND comic_id = ? AND folder_id = ?",
    )
    .run(sourceKey, comicId, folderId);
}

export function isFavorite(sourceKey: string, comicId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT id FROM favorites WHERE source_key = ? AND comic_id = ? LIMIT 1",
    )
    .get(sourceKey, comicId);
  return Boolean(row);
}
