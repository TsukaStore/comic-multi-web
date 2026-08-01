import { getDb } from "../db/index.ts";

export type SearchHistoryItem = {
  keyword: string;
  updatedAt: number;
};

const MAX_ITEMS = 50;

export function listSearchHistory(limit = MAX_ITEMS): SearchHistoryItem[] {
  const rows = getDb()
    .prepare(
      "SELECT keyword, updated_at FROM search_history ORDER BY updated_at DESC LIMIT ?",
    )
    .all(limit) as { keyword: string; updated_at: number }[];
  return rows.map((r) => ({
    keyword: r.keyword,
    updatedAt: r.updated_at,
  }));
}

/** Upsert keyword (move to top). Empty / whitespace ignored. */
export function pushSearchHistory(keyword: string) {
  const k = keyword.trim();
  if (!k) return;
  const updatedAt = Date.now();
  getDb()
    .prepare(
      `INSERT INTO search_history (keyword, updated_at) VALUES (?, ?)
       ON CONFLICT(keyword) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(k, updatedAt);

  // cap table size
  getDb()
    .prepare(
      `DELETE FROM search_history WHERE keyword NOT IN (
         SELECT keyword FROM search_history ORDER BY updated_at DESC LIMIT ?
       )`,
    )
    .run(MAX_ITEMS);
}

export function deleteSearchHistory(keyword: string) {
  getDb()
    .prepare("DELETE FROM search_history WHERE keyword = ?")
    .run(keyword.trim());
}

export function clearSearchHistory() {
  getDb().prepare("DELETE FROM search_history").run();
}
