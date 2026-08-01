/**
 * nhentai adapter — API v2 first (public + optional User token)
 * Avoids HTML Cloudflare challenges for browse/search/read.
 */
import type {
  AccountStatus,
  ComicBrief,
  ComicInfo,
  ExploreMixed,
  PageResult,
} from "../../domain/models.ts";
import { clearSourceAccount, getSourceAccount, setSourceAccount } from "../../db/index.ts";
import { DEFAULT_UA, httpFetch } from "../../http/client.ts";
import type { ComicSourceAdapter, LoginPayload } from "../adapter.ts";
import { SourceError } from "../adapter.ts";

const BASE = "https://nhentai.net";
const API = `${BASE}/api/v2`;

function accountData() {
  return getSourceAccount("nhentai") || {};
}

function ua() {
  return (accountData().ua as string) || DEFAULT_UA;
}

function parseCookieString(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[;\n]/)) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function cookieMap(): Record<string, string> {
  const acc = accountData();
  const map = parseCookieString(String(acc.cookie || ""));
  if (acc.sessionid) map.sessionid = String(acc.sessionid);
  if (acc.access_token) map.access_token = String(acc.access_token);
  if (acc.refresh_token) map.refresh_token = String(acc.refresh_token);
  return map;
}

function accessToken(): string {
  return cookieMap().access_token || "";
}

function refreshToken(): string {
  return cookieMap().refresh_token || "";
}

/** Merge token fields back into cookie string for storage */
function mergeCookie(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function apiHeaders(extra: Record<string, string> = {}) {
  const acc = accountData();
  const h: Record<string, string> = {
    "User-Agent": ua(),
    Accept: "application/json",
    Referer: `${BASE}/`,
    ...extra,
  };
  if (acc.cookie) h.Cookie = String(acc.cookie);
  const token = accessToken();
  // OpenAPI: User Token → `Authorization: User <token>`
  if (token) h.Authorization = `User ${token}`;
  return h;
}

type NhUser = {
  id: number | string;
  username?: string;
  slug?: string;
  email?: string;
  about?: string;
  avatar_url?: string;
};

/** POST /api/v2/auth/refresh → new tokens */
async function refreshAccessToken(): Promise<boolean> {
  const rt = refreshToken();
  if (!rt) return false;
  const res = await httpFetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: {
      "User-Agent": ua(),
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: `${BASE}/`,
      ...(accountData().cookie ? { Cookie: String(accountData().cookie) } : {}),
    },
    body: JSON.stringify({ refresh_token: rt }),
    retry: false,
    timeoutMs: 15_000,
  });
  const text = await res.text();
  if (!res.ok) return false;
  try {
    const json = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      user?: NhUser;
    };
    if (!json.access_token) return false;
    const map = cookieMap();
    map.access_token = json.access_token;
    if (json.refresh_token) map.refresh_token = json.refresh_token;
    const user = json.user;
    setSourceAccount("nhentai", {
      ...accountData(),
      cookie: mergeCookie(map),
      access_token: json.access_token,
      refresh_token: json.refresh_token || rt,
      username: user?.username ?? accountData().username,
      name: user?.username ?? accountData().name,
      userId: user?.id != null ? String(user.id) : accountData().userId,
      email: user?.email ?? accountData().email,
    });
    return true;
  } catch {
    return false;
  }
}

async function apiJson<T>(
  path: string,
  options: { method?: string; body?: unknown; allowRefresh?: boolean } = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;
  const method = options.method || "GET";
  const headers = apiHeaders(
    options.body != null ? { "Content-Type": "application/json" } : {},
  );
  let res = await httpFetch(url, {
    method,
    headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
    retry: false,
    timeoutMs: 20_000,
  });
  if (res.status === 401 && options.allowRefresh !== false) {
    const ok = await refreshAccessToken();
    if (ok) {
      res = await httpFetch(url, {
        method,
        headers: apiHeaders(
          options.body != null ? { "Content-Type": "application/json" } : {},
        ),
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        retry: false,
        timeoutMs: 20_000,
      });
    }
  }
  const text = await res.text();
  if (!res.ok) {
    throw new SourceError(
      res.status === 401 ? "AUTH_EXPIRED" : "API_ERROR",
      `nhentai API ${res.status}: ${text.slice(0, 160)}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError("BAD_RESPONSE", `nhentai invalid JSON: ${text.slice(0, 80)}`);
  }
}

/** GET /api/v2/user — account profile (bypasses HTML CF when token valid) */
async function fetchUserProfile(): Promise<{
  username?: string;
  userId?: string;
  email?: string;
  about?: string;
  avatar?: string;
  sessionOk: boolean;
}> {
  const user = await apiJson<NhUser>("/user");
  return {
    username: user.username || user.slug,
    userId: user.id != null ? String(user.id) : undefined,
    email: user.email,
    about: user.about,
    avatar: user.avatar_url
      ? user.avatar_url.startsWith("http")
        ? user.avatar_url
        : `${BASE}/${user.avatar_url.replace(/^\//, "")}`
      : undefined,
    sessionOk: true,
  };
}

async function refreshProfile() {
  // Prefer API (works with access_token even when HTML is CF-blocked)
  if (accessToken() || refreshToken()) {
    try {
      return await fetchUserProfile();
    } catch {
      // fall through
    }
  }
  return { sessionOk: false as const };
}

type CdnConfig = { image_servers: string[]; thumb_servers: string[] };
let cdnCache: CdnConfig | null = null;

async function getCdn(): Promise<CdnConfig> {
  if (cdnCache) return cdnCache;
  // public endpoint — no login required
  cdnCache = await apiJson<CdnConfig>("/cdn", { allowRefresh: false });
  return cdnCache;
}

function pickServer(servers: string[], mediaId: string) {
  const n = Number(mediaId) || 0;
  return servers[n % servers.length] || servers[0];
}

async function resolveMediaUrl(path: string, kind: "image" | "thumb") {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const cdn = await getCdn();
  const servers = kind === "image" ? cdn.image_servers : cdn.thumb_servers;
  const mediaId = path.replace(/^\//, "").split("/")[1] || "0";
  const base = pickServer(servers, mediaId).replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}

type ApiListItem = {
  id: number;
  media_id?: string;
  english_title?: string;
  japanese_title?: string;
  thumbnail?: string;
  num_pages?: number;
};

async function toBrief(item: ApiListItem): Promise<ComicBrief> {
  const thumb =
    item.thumbnail ||
    (item.media_id ? `galleries/${item.media_id}/thumb.webp` : "");
  return {
    id: String(item.id),
    sourceKey: "nhentai",
    title: item.english_title || item.japanese_title || String(item.id),
    subTitle: `ID: ${item.id}`,
    cover: thumb ? await resolveMediaUrl(thumb, "thumb") : "",
    tags: [],
    description: "",
    pageCount: item.num_pages,
  };
}

function extractList(data: unknown): {
  items: ApiListItem[];
  maxPage: number | null;
} {
  if (Array.isArray(data)) {
    return { items: data as ApiListItem[], maxPage: null };
  }
  const o = data as { result?: ApiListItem[]; num_pages?: number };
  return { items: o.result || [], maxPage: o.num_pages ?? null };
}

function mapSearchSort(option?: string): string {
  const raw = (option || "").replace(/^&sort=/, "").replace(/^sort=/, "");
  const allowed = ["date", "popular", "popular-today", "popular-week", "popular-month"];
  if (allowed.includes(raw)) return raw;
  if (!raw) return "date";
  return "date";
}

export const nhentai: ComicSourceAdapter = {
  key: "nhentai",
  name: "nhentai",
  capabilities: {
    search: true,
    category: true,
    ranking: false,
    account: true,
    networkFavorites: true,
    comments: false,
    multiChapter: false,
  },
  imageHosts: ["nhentai.net", "nhentai.to"],
  searchOptions: [
    { value: "date", label: "最新" },
    { value: "popular", label: "热门" },
    { value: "popular-today", label: "今日热门" },
    { value: "popular-week", label: "本周热门" },
    { value: "popular-month", label: "本月热门" },
  ],

  getAccountStatus(): AccountStatus {
    const acc = accountData();
    const map = cookieMap();
    const loggedIn = Boolean(
      acc.cookie || acc.sessionid || map.access_token || acc.access_token,
    );
    return {
      sourceKey: "nhentai",
      name: "nhentai",
      loggedIn,
      allowReLogin: false,
      registerUrl: `${BASE}/register/`,
      loginMode: "cookies",
      description:
        "在浏览器登录源站后复制 Cookie。需含 access_token（或 sessionid）；未填 UA 时用当前浏览器。",
      fields: [
        {
          key: "cookie",
          label: "Cookie",
          type: "textarea",
          required: true,
          placeholder: "access_token=…; refresh_token=…; cf_clearance=…",
          hint: "从浏览器复制完整 Cookie；登录态主要靠 access_token / refresh_token",
        },
        {
          key: "ua",
          label: "User-Agent",
          type: "text",
          required: false,
          placeholder: "留空则用当前浏览器",
          hint: "一般不用改",
        },
      ],
      // same shape as picacg profile block
      infoItems: loggedIn
        ? [
            { title: "账号", value: String(acc.email || "—") },
            { title: "用户名", value: String(acc.username || acc.name || "—") },
            { title: "UID", value: acc.userId ? String(acc.userId) : "—" },
            { title: "简介", value: String(acc.about || "—") },
          ]
        : [],
    };
  },

  getExplorePages() {
    return [{ key: "home", title: "首页", type: "mixed" }];
  },

  async loadExplore(_pageKey, page) {
    // API v2 (public) — avoids HTML Cloudflare wall
    if (page <= 1) {
      const [popularRaw, latestRaw] = await Promise.all([
        apiJson<unknown>("/galleries/popular", { allowRefresh: false }),
        apiJson<unknown>("/galleries?page=1", { allowRefresh: false }),
      ]);
      const popular = extractList(popularRaw);
      const latest = extractList(latestRaw);
      return {
        parts: popular.items.length
          ? [
              {
                title: "Popular",
                comics: await Promise.all(popular.items.map(toBrief)),
              },
            ]
          : [],
        items: await Promise.all(latest.items.map(toBrief)),
        maxPage: latest.maxPage,
      } satisfies ExploreMixed;
    }
    const latest = extractList(
      await apiJson<unknown>(`/galleries?page=${page}`, { allowRefresh: false }),
    );
    return {
      items: await Promise.all(latest.items.map(toBrief)),
      maxPage: latest.maxPage,
    };
  },

  async search(keyword, page, options = []) {
    const sort = mapSearchSort(options[0]);
    const q = encodeURIComponent(keyword);
    const data = await apiJson<unknown>(
      `/search?query=${q}&page=${page}&sort=${encodeURIComponent(sort)}`,
      { allowRefresh: false },
    );
    const list = extractList(data);
    return {
      items: await Promise.all(list.items.map(toBrief)),
      maxPage: list.maxPage ?? 1,
    } satisfies PageResult<ComicBrief>;
  },

  async getCategories() {
    return [
      {
        name: "language",
        children: ["chinese", "japanese", "english"],
      },
    ];
  },

  async loadCategory(category, param, options, page) {
    // map to search language:xxx
    let lang = param?.split("/").filter(Boolean).pop() || category;
    if (lang === "language") lang = "chinese";
    const sort = mapSearchSort(options[0]);
    return this.search(`language:${lang}`, page, [sort === "date" ? "" : sort]);
  },

  async loadComicInfo(id) {
    const cleanId = id.replace(/\D/g, "") || id;
    if (!cleanId) {
      // random gallery
      const r = await apiJson<ApiListItem>("/galleries/random", {
        allowRefresh: false,
      });
      return this.loadComicInfo(String(r.id));
    }

    const g = await apiJson<{
      id: number;
      media_id?: string;
      title?: { english?: string; japanese?: string; pretty?: string };
      cover?: { path?: string };
      tags?: { type?: string; name?: string }[];
      num_pages?: number;
      pages?: { path?: string }[];
    }>(`/galleries/${cleanId}`, { allowRefresh: false });

    const tags: Record<string, string[]> = {};
    for (const t of g.tags || []) {
      const type = t.type || "tag";
      (tags[type] ??= []).push(t.name || "");
    }

    const coverPath =
      g.cover?.path ||
      (g.media_id ? `galleries/${g.media_id}/cover.webp` : "");

    let isFavorite: boolean | undefined;
    if (accessToken() || refreshToken()) {
      try {
        const fav = await apiJson<{ favorited?: boolean }>(
          `/galleries/${cleanId}/favorite`,
        );
        isFavorite = Boolean(fav.favorited);
      } catch {
        // ignore favorite check failures
      }
    }

    return {
      sourceKey: "nhentai",
      comicId: String(g.id),
      title:
        g.title?.pretty || g.title?.english || g.title?.japanese || String(g.id),
      subTitle: g.title?.japanese || g.title?.english,
      cover: coverPath ? await resolveMediaUrl(coverPath, "thumb") : "",
      tags,
      pageCount: g.num_pages ?? g.pages?.length,
      chapters: { "1": "阅读" },
      isFavorite,
    } satisfies ComicInfo;
  },

  async loadComicPages(id) {
    const cleanId = id.replace(/\D/g, "") || id;
    const g = await apiJson<{
      pages?: { path?: string; number?: number }[];
      media_id?: string;
      num_pages?: number;
    }>(`/galleries/${cleanId}`, { allowRefresh: false });

    if (g.pages?.length) {
      return Promise.all(
        g.pages.map((p) => resolveMediaUrl(p.path || "", "image")),
      );
    }
    throw new SourceError("FETCH_FAILED", "nhentai: 无法解析图片列表");
  },

  async login(payload: LoginPayload) {
    const cookieRaw =
      payload.cookie ||
      payload.cookies?.cookie ||
      (payload.username === "cookie" ? payload.password : "") ||
      "";
    const uaFromForm = (
      payload.extra?.ua != null
        ? String(payload.extra.ua)
        : payload.cookies?.ua ||
          (payload as { fields?: { ua?: string } }).fields?.ua ||
          ""
    ).trim();

    let cookie = cookieRaw.trim();
    const map = cookie ? parseCookieString(cookie) : { ...(payload.cookies || {}) };
    if (!cookie && Object.keys(map).length) {
      cookie = Object.entries(map)
        .filter(([k]) => !["ua", "username", "password", "apiKey"].includes(k))
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    const sessionid = map.sessionid || map.session_id;
    const access = map.access_token;
    const refresh = map.refresh_token;
    if (!cookie && !sessionid && !access) {
      throw new SourceError(
        "BAD_REQUEST",
        "请粘贴 Cookie（需含 access_token 或 sessionid）",
      );
    }

    setSourceAccount("nhentai", {
      ...accountData(),
      cookie: cookie || undefined,
      sessionid: sessionid || undefined,
      access_token: access || undefined,
      refresh_token: refresh || undefined,
      ua: uaFromForm || accountData().ua,
      logged: true,
      username: undefined,
      userId: undefined,
      email: undefined,
      about: undefined,
    });

    // Pull profile via API v2 (User token)
    try {
      const profile = await refreshProfile();
      if (profile.sessionOk || profile.username) {
        setSourceAccount("nhentai", {
          ...accountData(),
          username: profile.username,
          name: profile.username,
          userId: profile.userId,
          email: profile.email,
          about: profile.about,
          avatar: profile.avatar,
          sessionOk: profile.sessionOk,
          profileAt: Date.now(),
        });
      }
    } catch {
      // keep tokens; profile may fill on next refresh
    }
  },

  async logout() {
    clearSourceAccount("nhentai");
  },

  isLoggedIn() {
    const acc = accountData();
    const map = cookieMap();
    return Boolean(
      acc.cookie || acc.sessionid || map.access_token || acc.access_token,
    );
  },

  async refreshAccountInfo() {
    if (!this.isLoggedIn?.()) return;
    const acc = accountData();
    const at = Number(acc.profileAt || 0);
    // force refresh if missing profile fields
    if (acc.username && acc.email && Date.now() - at < 120_000) return;
    try {
      const profile = await refreshProfile();
      if (!profile.username && !profile.userId) return;
      setSourceAccount("nhentai", {
        ...accountData(),
        username: profile.username ?? acc.username,
        name: profile.username ?? acc.name,
        userId: profile.userId ?? acc.userId,
        email: profile.email ?? acc.email,
        about: profile.about ?? acc.about,
        avatar: profile.avatar ?? acc.avatar,
        sessionOk: profile.sessionOk,
        profileAt: Date.now(),
      });
    } catch {
      // keep cached
    }
  },

  async getNetworkFavorites(page) {
    if (!this.isLoggedIn?.()) {
      throw new SourceError("NOT_LOGGED_IN", "请先登录 nhentai（Cookie）");
    }
    if (!accessToken() && !refreshToken()) {
      throw new SourceError(
        "NOT_LOGGED_IN",
        "云端收藏需要 access_token，请重新粘贴完整 Cookie",
      );
    }
    const data = await apiJson<{
      result?: ApiListItem[];
      num_pages?: number;
      total?: number;
    }>(`/favorites?page=${page}`);
    return {
      items: await Promise.all((data.result || []).map(toBrief)),
      maxPage: data.num_pages ?? null,
    };
  },

  async toggleNetworkFavorite(id, add) {
    if (!accessToken() && !refreshToken()) {
      throw new SourceError(
        "NOT_LOGGED_IN",
        "云端收藏需要登录（Cookie 含 access_token）",
      );
    }
    const gid = id.replace(/\D/g, "") || id;
    await apiJson(`/galleries/${gid}/favorite`, {
      method: add ? "POST" : "DELETE",
    });
  },

  getImageRequest(url) {
    const acc = accountData();
    return {
      url,
      headers: {
        "User-Agent": ua(),
        Referer: `${BASE}/`,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(acc.cookie ? { Cookie: String(acc.cookie) } : {}),
      },
    };
  },
};
