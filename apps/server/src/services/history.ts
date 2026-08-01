import type { HistoryItem } from "../domain/models.ts";

import { getDb } from "../db/index.ts";

export function listHistory(limit = 100): HistoryItem[] {
  const rows = getDb()
    .prepare(
      "SELECT source_key, comic_id, title, cover, ep, page, updated_at FROM history ORDER BY updated_at DESC LIMIT ?",
    )
    .all(limit) as {
    source_key: string;
    comic_id: string;
    title: string;
    cover: string;
    ep: string;
    page: number;
    updated_at: number;
  }[];
  return rows.map((r) => ({
    sourceKey: r.source_key,
    comicId: r.comic_id,
    title: r.title,
    cover: r.cover,
    ep: r.ep,
    page: r.page,
    updatedAt: r.updated_at,
  }));
}

export function upsertHistory(item: Omit<HistoryItem, "updatedAt"> & { updatedAt?: number }) {
  const updatedAt = item.updatedAt ?? Date.now();
  getDb()
    .prepare(
      `INSERT INTO history (source_key, comic_id, title, cover, ep, page, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_key, comic_id) DO UPDATE SET
         title = excluded.title,
         cover = excluded.cover,
         ep = excluded.ep,
         page = excluded.page,
         updated_at = excluded.updated_at`,
    )
    .run(
      item.sourceKey,
      item.comicId,
      item.title,
      item.cover,
      item.ep,
      item.page,
      updatedAt,
    );
}

export function clearHistory() {
  getDb().prepare("DELETE FROM history").run();
}

export function deleteHistory(sourceKey: string, comicId: string) {
  getDb()
    .prepare("DELETE FROM history WHERE source_key = ? AND comic_id = ?")
    .run(sourceKey, comicId);
}
