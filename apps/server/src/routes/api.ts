import { Hono } from "hono";
import { setCookie } from "hono/cookie";

import { config } from "../config.ts";
import { err, ok } from "../domain/result.ts";
import {
  expectedAppToken,
  isAppAuthenticated,
} from "../lib/app-auth.ts";
import {
  AccountActionBodySchema,
  AccountOptionBodySchema,
  AddFavoriteBodySchema,
  AppAuthBodySchema,
  AppSettingsBodySchema,
  CategoryQuerySchema,
  ComicPagesQuerySchema,
  CreateFolderBodySchema,
  DeleteDownloadQuerySchema,
  EnqueueDownloadBodySchema,
  HistoryDeleteQuerySchema,
  LocalFavoritesQuerySchema,
  LoginBodySchema,
  PageQuerySchema,
  PutHistoryBodySchema,
  RankingQuerySchema,
  RemoveFavoriteQuerySchema,
  SearchHistoryDeleteQuerySchema,
  SearchQuerySchema,
  ToggleFavoriteBodySchema,
} from "../domain/schemas.ts";
import type { AccountStatus, AppSettings } from "../domain/models.ts";
import { getSetting, setSetting } from "../db/index.ts";
import { applyHttpProxyFromSettings, httpBuffer } from "../http/client.ts";
import { setLogLevel } from "../lib/log.ts";
import { zValidator } from "../lib/validator.ts";
import type { ComicSourceAdapter } from "../sources/adapter.ts";
import {
  addFavorite,
  createFolder,
  isFavorite,
  listFavorites,
  listFolders,
  removeFavorite,
} from "../services/favorites.ts";
import {
  cancelDownload,
  deleteDownload,
  enqueueDownload,
  listDownloads,
} from "../services/downloads.ts";
import {
  clearHistory,
  deleteHistory,
  listHistory,
  upsertHistory,
} from "../services/history.ts";
import {
  clearSearchHistory,
  deleteSearchHistory,
  listSearchHistory,
  pushSearchHistory,
} from "../services/search-history.ts";
import { pullWebdav, pushWebdav } from "../services/webdav.ts";
import {
  ALL_SOURCES,
  getAllImageHosts,
  getSource,
  listSources,
} from "../sources/registry.ts";
import { SourceError } from "../sources/adapter.ts";

function handle(e: unknown) {
  if (e instanceof SourceError) {
    return err(e.code, e.message);
  }
  return err("INTERNAL", e instanceof Error ? e.message : String(e));
}

function accountStatusOf(source: ComicSourceAdapter): AccountStatus {
  const status = source.getAccountStatus?.();
  if (!status) {
    throw new SourceError("UNSUPPORTED", "该源不支持账号状态");
  }
  return status;
}

function parsePage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw || String(fallback));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/**
 * Chained routes required for hono/client type inference.
 * Mounted at `/api` — frontend: `hc<AppType>("/api")`
 */
export const api = new Hono()
  .get("/health", (c) => c.json(ok({ status: "ok" as const, time: Date.now() })))

  .get("/sources", (c) => {
    const sources = listSources().map((s) => ({
      key: s.key,
      name: s.name,
      capabilities: s.capabilities,
      loggedIn: s.isLoggedIn?.() ?? false,
      enabled: true as const,
      account: s.getAccountStatus?.() ?? null,
      searchOptions: s.searchOptions ?? [],
      rankingOptions: s.rankingOptions ?? [],
      explorePages: s.getExplorePages(),
    }));
    return c.json(ok(sources));
  })

  /** All built-in sources (including currently disabled) for settings toggles. */
  .get("/sources/catalog", (c) => {
    return c.json(
      ok(
        ALL_SOURCES.map((s) => ({
          key: s.key,
          name: s.name,
          capabilities: s.capabilities,
        })),
      ),
    );
  })

  .get("/accounts", async (c) => {
    const sources = listSources().filter(
      (s) => s.capabilities.account && s.getAccountStatus,
    );
    await Promise.all(
      sources.map(async (s) => {
        try {
          await s.refreshAccountInfo?.();
        } catch {
          // keep cached status
        }
      }),
    );
    const accounts = sources.map((s) => s.getAccountStatus!());
    return c.json(ok(accounts));
  })

  .get("/sources/:key/account", async (c) => {
    try {
      const source = getSource(c.req.param("key"));
      if (!source.getAccountStatus) {
        return c.json(err("UNSUPPORTED", "该源不支持账号"), 400);
      }
      try {
        await source.refreshAccountInfo?.();
      } catch {
        // ignore
      }
      return c.json(ok(source.getAccountStatus()));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .get("/sources/:key/explore", (c) => {
    try {
      const source = getSource(c.req.param("key"));
      return c.json(ok(source.getExplorePages()));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .get(
    "/sources/:key/explore/:pageKey",
    zValidator("query", PageQuerySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const page = parsePage(c.req.valid("query").page);
        const data = await source.loadExplore(c.req.param("pageKey"), page);
        return c.json(ok(data));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .get(
    "/sources/:key/search",
    zValidator("query", SearchQuerySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const { q = "", page, option } = c.req.valid("query");
        const options = option ? [option] : [];
        const data = await source.search(q, parsePage(page), options);
        // record keyword on first page of a real search (like PicaComic)
        if (q.trim() && parsePage(page) <= 1) {
          pushSearchHistory(q);
        }
        return c.json(ok(data));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .get("/sources/:key/categories", async (c) => {
    try {
      const source = getSource(c.req.param("key"));
      const data = (await source.getCategories?.()) ?? [];
      return c.json(ok(data));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .get(
    "/sources/:key/category",
    zValidator("query", CategoryQuerySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const {
          name = "",
          param = null,
          page,
          option,
        } = c.req.valid("query");
        const data = await source.loadCategory?.(
          name,
          param,
          option ? [option] : [],
          parsePage(page),
        );
        return c.json(ok(data ?? { items: [], maxPage: null }));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .get(
    "/sources/:key/ranking",
    zValidator("query", RankingQuerySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const { option = "H24", page } = c.req.valid("query");
        const data = await source.loadRanking?.(option, parsePage(page));
        return c.json(ok(data ?? { items: [], maxPage: 1 }));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .get("/sources/:key/comics/:id", async (c) => {
    try {
      const source = getSource(c.req.param("key"));
      const id = decodeURIComponent(c.req.param("id"));
      const data = await source.loadComicInfo(id);
      data.isFavorite = isFavorite(source.key, id);
      return c.json(ok(data));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .get(
    "/sources/:key/comics/:id/pages",
    zValidator("query", ComicPagesQuerySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const id = decodeURIComponent(c.req.param("id"));
        const ep = c.req.valid("query").ep || null;
        const pages = await source.loadComicPages(id, ep);
        const proxied = pages.map(
          (u) =>
            `/api/proxy/image?s=${encodeURIComponent(source.key)}&u=${encodeURIComponent(u)}&comicId=${encodeURIComponent(id)}${ep ? `&ep=${encodeURIComponent(ep)}` : ""}`,
        );
        return c.json(ok({ pages: proxied, raw: pages }));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .post(
    "/sources/:key/login",
    zValidator("json", LoginBodySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        if (!source.login) {
          return c.json(err("UNSUPPORTED", "该源不支持登录"), 400);
        }
        const body = c.req.valid("json");
        const cookies = {
          ...(body.cookies || {}),
          ...(body.fields || {}),
        };
        const cookie = body.cookie || body.fields?.cookie;

        await source.login({
          username: body.username ?? body.fields?.username,
          password: body.password ?? body.fields?.password,
          cookie,
          cookies,
          extra: body.extra,
        });
        return c.json(ok(accountStatusOf(source)));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .post("/sources/:key/relogin", async (c) => {
    try {
      const source = getSource(c.req.param("key"));
      if (!source.reLogin) {
        return c.json(err("UNSUPPORTED", "该源不支持重新登录"), 400);
      }
      await source.reLogin();
      return c.json(ok(accountStatusOf(source)));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .post("/sources/:key/logout", async (c) => {
    try {
      const source = getSource(c.req.param("key"));
      await source.logout?.();
      return c.json(ok(accountStatusOf(source)));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .put(
    "/sources/:key/account/options",
    zValidator("json", AccountOptionBodySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const body = c.req.valid("json");
        if (!source.setAccountOption) {
          return c.json(err("UNSUPPORTED", "该源无账号选项"), 400);
        }
        await source.setAccountOption(body.key, body.value);
        return c.json(ok(accountStatusOf(source)));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .post(
    "/sources/:key/account/actions",
    zValidator("json", AccountActionBodySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const { action } = c.req.valid("json");
        if (!source.runAccountAction) {
          return c.json(err("UNSUPPORTED", "该源无此操作"), 400);
        }
        const result = (await source.runAccountAction(action)) ?? {};
        return c.json(
          ok({
            account: accountStatusOf(source),
            message: (result as { message?: string }).message,
          }),
        );
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .get(
    "/sources/:key/favorites",
    zValidator("query", PageQuerySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const page = parsePage(c.req.valid("query").page);
        const data = await source.getNetworkFavorites?.(page);
        return c.json(ok(data ?? { items: [], maxPage: null }));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  .post(
    "/sources/:key/favorites/:id",
    zValidator("json", ToggleFavoriteBodySchema),
    async (c) => {
      try {
        const source = getSource(c.req.param("key"));
        const body = c.req.valid("json");
        await source.toggleNetworkFavorite?.(
          decodeURIComponent(c.req.param("id")),
          body.add !== false,
        );
        return c.json(ok({ success: true as const }));
      } catch (e) {
        return c.json(handle(e), 400);
      }
    },
  )

  // Binary — still registered for routing; clients use <img src> not hc
  .get("/proxy/image", async (c) => {
    try {
      const u = c.req.query("u");
      const s = c.req.query("s") || "";
      if (!u) return c.json(err("BAD_REQUEST", "missing u"), 400);

      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        return c.json(err("BAD_REQUEST", "invalid url"), 400);
      }

      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host.endsWith(".local") ||
        host.startsWith("127.") ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        host === "0.0.0.0" ||
        host === "[::1]"
      ) {
        return c.json(err("SSRF_BLOCKED", "blocked host"), 403);
      }

      const allowed = getAllImageHosts();
      const okHost = allowed.some(
        (h) =>
          host === h || host.endsWith(h) || host.includes(h.replace(/^\./, "")),
      );
      if (!okHost && s) {
        const source = listSources().find((x) => x.key === s);
        if (!source?.imageHosts.some((h) => host.includes(h.replace(/^\./, "")))) {
          return c.json(err("SSRF_BLOCKED", `host not allowed: ${host}`), 403);
        }
      } else if (!okHost) {
        return c.json(err("SSRF_BLOCKED", `host not allowed: ${host}`), 403);
      }

      const source = s ? listSources().find((x) => x.key === s) : undefined;
      const req = source
        ? source.getImageRequest(u, {
            sourceKey: s,
            comicId: c.req.query("comicId") || undefined,
            ep: c.req.query("ep") || undefined,
          })
        : { url: u, headers: {} as Record<string, string> };

      const fetched = await httpBuffer(req.url, { headers: req.headers });
      let outBuf: Uint8Array = fetched.buffer;
      let contentType = fetched.contentType;
      if (source?.transformImage) {
        outBuf = await source.transformImage(Buffer.from(outBuf), {
          sourceKey: s,
          comicId: c.req.query("comicId") || undefined,
          ep: c.req.query("ep") || undefined,
        });
        contentType = "image/jpeg";
      }

      return new Response(Buffer.from(outBuf), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .get(
    "/local/favorites",
    zValidator("query", LocalFavoritesQuerySchema),
    (c) => {
      const folderId = c.req.valid("query").folderId || undefined;
      return c.json(
        ok({
          folders: listFolders(),
          items: listFavorites(folderId),
        }),
      );
    },
  )

  .post(
    "/local/favorites",
    zValidator("json", AddFavoriteBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(ok(addFavorite(body)));
    },
  )

  .delete(
    "/local/favorites",
    zValidator("query", RemoveFavoriteQuerySchema),
    async (c) => {
      const { sourceKey, comicId, folderId = "default" } = c.req.valid("query");
      removeFavorite(sourceKey, comicId, folderId);
      return c.json(ok({ success: true as const }));
    },
  )

  .post(
    "/local/folders",
    zValidator("json", CreateFolderBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(ok(createFolder(body.name)));
    },
  )

  .get("/local/history", (c) => c.json(ok(listHistory())))

  .put(
    "/local/history",
    zValidator("json", PutHistoryBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      upsertHistory({
        sourceKey: body.sourceKey,
        comicId: body.comicId,
        title: body.title,
        cover: body.cover,
        ep: body.ep ?? "",
        page: body.page ?? 0,
      });
      return c.json(ok({ success: true as const }));
    },
  )

  .delete(
    "/local/history",
    zValidator("query", HistoryDeleteQuerySchema),
    async (c) => {
      const { sourceKey, comicId } = c.req.valid("query");
      if (sourceKey && comicId) deleteHistory(sourceKey, comicId);
      else clearHistory();
      return c.json(ok({ success: true as const }));
    },
  )

  .get("/local/search-history", (c) => c.json(ok(listSearchHistory())))

  .delete(
    "/local/search-history",
    zValidator("query", SearchHistoryDeleteQuerySchema),
    async (c) => {
      const { keyword } = c.req.valid("query");
      if (keyword?.trim()) deleteSearchHistory(keyword);
      else clearSearchHistory();
      return c.json(ok({ success: true as const }));
    },
  )

  .get("/downloads", (c) => c.json(ok(listDownloads())))

  .post(
    "/downloads",
    zValidator("json", EnqueueDownloadBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(ok(enqueueDownload(body)));
    },
  )

  .delete(
    "/downloads/:id",
    zValidator("query", DeleteDownloadQuerySchema),
    (c) => {
      const hard = c.req.valid("query").hard === "1";
      if (hard) deleteDownload(c.req.param("id"));
      else cancelDownload(c.req.param("id"));
      return c.json(ok({ success: true as const }));
    },
  )

  .get("/settings", (c) => {
    const defaults: AppSettings = {
      enabledSources: ["nhentai", "picacg", "ehentai", "jm"],
      readerMode: "scroll",
      preloadCount: 3,
      logLevel: "warn",
    };
    const s = getSetting<AppSettings>("app", defaults);
    return c.json(ok({ ...defaults, ...s, logLevel: s.logLevel ?? "warn" }));
  })

  .put(
    "/settings",
    zValidator("json", AppSettingsBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      setSetting("app", body);
      // settings are authoritative: empty/omitted httpProxy clears process proxy
      applyHttpProxyFromSettings(body.httpProxy ?? "");
      setLogLevel(body.logLevel ?? "warn");
      return c.json(ok(body));
    },
  )

  .post("/sync/webdav/push", async (c) => {
    try {
      return c.json(ok(await pushWebdav()));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .post("/sync/webdav/pull", async (c) => {
    try {
      return c.json(ok(await pullWebdav()));
    } catch (e) {
      return c.json(handle(e), 400);
    }
  })

  .get("/auth/status", (c) => {
    if (!config.appPassword) {
      return c.json(ok({ required: false as const, authenticated: true as const }));
    }
    return c.json(
      ok({ required: true as const, authenticated: isAppAuthenticated(c) }),
    );
  })

  .post(
    "/auth/login",
    zValidator("json", AppAuthBodySchema),
    async (c) => {
      if (!config.appPassword) {
        return c.json(ok({ required: false as const }));
      }
      const body = c.req.valid("json");
      if (!body.password) {
        return c.json(err("VALIDATION", "password 必填"), 400);
      }
      if (body.password !== config.appPassword) {
        return c.json(err("BAD_PASSWORD", "口令错误"), 401);
      }
      const token = expectedAppToken();
      setCookie(c, "app_token", token, {
        httpOnly: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "Lax",
      });
      return c.json(ok({ required: true as const, token }));
    },
  );

/** Type for hono/client — import type only on the frontend */
export type AppType = typeof api;
