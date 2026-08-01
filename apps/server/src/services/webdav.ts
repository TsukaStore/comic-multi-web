import { createClient } from "webdav";
import type { AppSettings } from "../domain/models.ts";

import { getSetting } from "../db/index.ts";
import {
  addFavorite,
  listFavorites,
  listFolders,
} from "./favorites.ts";
import { listHistory, upsertHistory } from "./history.ts";

const REMOTE_PATH = "/comic-multi-web-sync.json";

function client() {
  const settings = getSetting<AppSettings>("app", {
    enabledSources: [],
    readerMode: "scroll",
    preloadCount: 3,
    logLevel: "warn",
  });
  const w = settings.webdav;
  if (!w?.url) throw new Error("WebDAV 未配置");
  return createClient(w.url, {
    username: w.username,
    password: w.password,
  });
}

export async function pushWebdav() {
  const payload = {
    version: 1,
    exportedAt: Date.now(),
    favorites: listFavorites(),
    folders: listFolders(),
    history: listHistory(500),
  };
  const c = client();
  await c.putFileContents(REMOTE_PATH, JSON.stringify(payload, null, 2), {
    overwrite: true,
  });
  return { bytes: JSON.stringify(payload).length };
}

export async function pullWebdav() {
  const c = client();
  const raw = await c.getFileContents(REMOTE_PATH, { format: "text" });
  const data = JSON.parse(String(raw)) as {
    favorites?: ReturnType<typeof listFavorites>;
    history?: ReturnType<typeof listHistory>;
  };
  if (data.history) {
    for (const h of data.history) {
      upsertHistory(h);
    }
  }
  if (data.favorites) {
    for (const f of data.favorites) {
      addFavorite({
        folderId: f.folderId,
        sourceKey: f.sourceKey,
        comicId: f.comicId,
        title: f.title,
        cover: f.cover,
        tags: f.tags,
      });
    }
  }
  return { favorites: data.favorites?.length ?? 0, history: data.history?.length ?? 0 };
}
