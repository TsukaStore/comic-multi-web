import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { DownloadTask } from "../domain/models.ts";

import { config } from "../config.ts";
import { getDb } from "../db/index.ts";
import { httpBuffer } from "../http/client.ts";
import { getSource } from "../sources/registry.ts";

let running = false;

function rowToTask(r: Record<string, unknown>): DownloadTask {
  return {
    id: String(r.id),
    sourceKey: String(r.source_key),
    comicId: String(r.comic_id),
    title: String(r.title),
    cover: String(r.cover ?? ""),
    ep: String(r.ep ?? ""),
    status: r.status as DownloadTask["status"],
    progress: Number(r.progress ?? 0),
    total: Number(r.total ?? 0),
    path: r.path ? String(r.path) : undefined,
    error: r.error ? String(r.error) : undefined,
    createdAt: Number(r.created_at),
  };
}

export function listDownloads(): DownloadTask[] {
  const rows = getDb()
    .prepare("SELECT * FROM downloads ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function enqueueDownload(input: {
  sourceKey: string;
  comicId: string;
  title: string;
  cover?: string;
  ep?: string;
}): DownloadTask {
  const id = randomUUID();
  const createdAt = Date.now();
  getDb()
    .prepare(
      `INSERT INTO downloads (id, source_key, comic_id, title, cover, ep, status, progress, total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 0, ?)`,
    )
    .run(
      id,
      input.sourceKey,
      input.comicId,
      input.title,
      input.cover ?? "",
      input.ep ?? "",
      createdAt,
    );
  void pump();
  return {
    id,
    sourceKey: input.sourceKey,
    comicId: input.comicId,
    title: input.title,
    cover: input.cover ?? "",
    ep: input.ep ?? "",
    status: "queued",
    progress: 0,
    total: 0,
    createdAt,
  };
}

export function cancelDownload(id: string) {
  getDb()
    .prepare(
      `UPDATE downloads SET status = 'cancelled' WHERE id = ? AND status IN ('queued','running','paused')`,
    )
    .run(id);
}

export function deleteDownload(id: string) {
  const row = getDb()
    .prepare("SELECT path FROM downloads WHERE id = ?")
    .get(id) as { path?: string } | undefined;
  if (row?.path && fs.existsSync(row.path)) {
    fs.rmSync(row.path, { recursive: true, force: true });
  }
  getDb().prepare("DELETE FROM downloads WHERE id = ?").run(id);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const next = getDb()
        .prepare(
          `SELECT * FROM downloads WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
        )
        .get() as Record<string, unknown> | undefined;
      if (!next) break;
      await runTask(rowToTask(next));
    }
  } finally {
    running = false;
  }
}

async function runTask(task: DownloadTask) {
  const db = getDb();
  db.prepare(`UPDATE downloads SET status = 'running' WHERE id = ?`).run(task.id);
  try {
    const source = getSource(task.sourceKey);
    const pages = await source.loadComicPages(task.comicId, task.ep || null);
    const dir = path.join(
      config.dataDir,
      "downloads",
      task.sourceKey,
      task.comicId,
      task.ep || "1",
    );
    fs.mkdirSync(dir, { recursive: true });
    db.prepare(`UPDATE downloads SET total = ?, path = ? WHERE id = ?`).run(
      pages.length,
      dir,
      task.id,
    );

    for (let i = 0; i < pages.length; i++) {
      const status = (
        db.prepare(`SELECT status FROM downloads WHERE id = ?`).get(task.id) as {
          status: string;
        }
      ).status;
      if (status === "cancelled") return;

      const req = source.getImageRequest(pages[i], {
        sourceKey: task.sourceKey,
        comicId: task.comicId,
        ep: task.ep,
      });
      const fetched = await httpBuffer(req.url, { headers: req.headers });
      let out: Buffer = Buffer.from(fetched.buffer);
      if (source.transformImage) {
        out = Buffer.from(
          await source.transformImage(out, {
            sourceKey: task.sourceKey,
            comicId: task.comicId,
            ep: task.ep,
          }),
        );
      }
      const file = path.join(dir, `${String(i + 1).padStart(4, "0")}.jpg`);
      fs.writeFileSync(file, out);
      db.prepare(`UPDATE downloads SET progress = ? WHERE id = ?`).run(i + 1, task.id);
    }
    db.prepare(`UPDATE downloads SET status = 'done', progress = total WHERE id = ?`).run(
      task.id,
    );
  } catch (e) {
    db.prepare(`UPDATE downloads SET status = 'error', error = ? WHERE id = ?`).run(
      (e as Error).message,
      task.id,
    );
  }
}
