import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Context } from "hono";

import { config } from "../config.ts";

const MIME: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

/** Built SPA + index fallback (non-`/api` routes). */
export async function spa(c: Context) {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith("/api")) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Not found" } },
      404,
    );
  }

  const dist = config.webDist;
  const rel = pathname === "/" ? "index.html" : pathname;
  const filePath = path.join(dist, rel);

  if (existsSync(filePath) && !filePath.endsWith(path.sep)) {
    const ext = path.extname(filePath);
    return new Response(readFileSync(filePath), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
      },
    });
  }

  const index = path.join(dist, "index.html");
  if (existsSync(index)) {
    return c.html(readFileSync(index, "utf8"));
  }
  return c.text("comic-multi-web API is running. Build apps/web for UI.", 200);
}
