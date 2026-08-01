/**
 * 禁漫天堂 — PicaComic aligned
 * headers: lib/network/jm_network/headers.dart
 * network: lib/network/jm_network/jm_network.dart
 * images: lib/network/jm_network/jm_image.dart
 */
import type { AccountStatus, ComicBrief, ComicInfo, ExploreMixed, PageResult } from "../../domain/models.ts";

import { clearSourceAccount, getSourceAccount, setSourceAccount } from "../../db/index.ts";
import { httpFetch } from "../../http/client.ts";
import type { ComicSourceAdapter, LoginPayload } from "../adapter.ts";
import { SourceError } from "../adapter.ts";
import {
  BUILTIN_API_DOMAINS,
  BUILTIN_IMG_URLS,
  JM_APP_VERSION,
  JM_DOMAIN_SECRET,
  JM_DOMAIN_URLS,
  convertJmData,
  convertJmDataWithSecret,
  jmToken,
} from "./crypto.ts";
import { scrambleImage } from "./scramble.ts";

/** PicaComic headers.dart ua */
const JM_UA =
  "Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36";
const JM_PKG = "com.example.app";

function accountData() {
  return getSourceAccount("jm") || {};
}

function appVersion() {
  return String(accountData().appVersion || JM_APP_VERSION);
}

function domains(): string[] {
  const custom = accountData().domains as string[] | undefined;
  return custom?.length ? custom : BUILTIN_API_DOMAINS;
}

function base(): string {
  const acc = accountData();
  if (acc.baseUrl) return String(acc.baseUrl).replace(/\/$/, "");
  const idx = Number(acc.domainIndex ?? 0) || 0;
  const list = domains();
  return `https://${list[idx % list.length]}`;
}

function imgBase(): string {
  const acc = accountData();
  if (acc.imgBase) return String(acc.imgBase).replace(/\/$/, "");
  return BUILTIN_IMG_URLS[0];
}

/** PicaComic getBaseHeaders + getApiOptions */
function apiHeaders(time: string, post: boolean): Record<string, string> {
  const token = jmToken(time);
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    // PicaComic always sends literal "Bearer" (session via short-lived cookies)
    Authorization: "Bearer",
    Origin: "https://localhost",
    Referer: "https://localhost/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Storage-Access": "active",
    "X-Requested-With": JM_PKG,
    token,
    tokenparam: `${time},${appVersion()}`,
    "user-agent": JM_UA,
  };
  if (post) h["Content-Type"] = "application/x-www-form-urlencoded";
  // inject short-lived session cookie from login if present
  const cookie = accountData().cookie as string | undefined;
  if (cookie) h.Cookie = cookie;
  return h;
}

/** PicaComic getImgHeaders */
function imgHeaders(): Record<string, string> {
  return {
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: "https://localhost/",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
    "User-Agent": JM_UA,
    "X-Requested-With": JM_PKG,
  };
}

function collectSetCookie(res: Response): string | undefined {
  // undici/node: getSetCookie() when available
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")!]
        : [];
  if (!list.length) return undefined;
  // keep name=value pairs only
  return list
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function jmRequest(
  method: "GET" | "POST",
  path: string,
  body?: string,
  isRetry = false,
): Promise<Record<string, unknown> | unknown[]> {
  const time = String(Math.floor(Date.now() / 1000));
  const url = `${base()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = apiHeaders(time, method === "POST");

  const res = await httpFetch(url, {
    method,
    headers,
    body,
    retry: false,
    timeoutMs: 20_000,
  });

  // merge session cookies (login)
  const setCookie = collectSetCookie(res);
  if (setCookie) {
    const prev = String(accountData().cookie || "");
    const merged = [prev, setCookie].filter(Boolean).join("; ");
    setSourceAccount("jm", { ...accountData(), cookie: merged });
  }

  const text = await res.text();
  let json: {
    code?: number | string;
    data?: string | Record<string, unknown> | unknown[];
    errorMsg?: string;
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new SourceError("BAD_RESPONSE", `JM invalid JSON: ${text.slice(0, 120)}`);
  }

  // 401: need login / re-login (PicaComic)
  if (res.status === 401 || Number(json.code) === 401) {
    const msg = json.errorMsg || "請先登入會員";
    if (!isRetry && /登入|登录|login/i.test(String(msg))) {
      const acc = accountData().account as string[] | undefined;
      if (acc?.[0] && acc?.[1]) {
        await jm.reLogin?.();
        return jmRequest(method, path, body, true);
      }
    }
    throw new SourceError("NOT_LOGGED_IN", String(msg));
  }

  const code = Number(json.code);
  if (!Number.isNaN(code) && code !== 200 && code !== 1 && code !== 0) {
    throw new SourceError("API_ERROR", json.errorMsg || `JM code ${json.code}`);
  }

  // PicaComic convertData(data, "$time$kJmSecret")
  if (typeof json.data === "string") {
    try {
      return convertJmData(json.data, time) as Record<string, unknown> | unknown[];
    } catch (e) {
      throw new SourceError(
        "DECODE_FAILED",
        `JM 响应解密失败: ${(e as Error).message}`,
      );
    }
  }
  if (json.data == null) return {};
  return json.data as Record<string, unknown> | unknown[];
}

/** PicaComic getJmCoverUrl / list item cover */
function coverUrl(id: string): string {
  return `${imgBase()}/media/albums/${id}_3x4.jpg`;
}

/** PicaComic getJmImageUrl */
function pageUrl(imageName: string, chapterId: string): string {
  if (imageName.startsWith("http")) return imageName;
  return `${imgBase()}/media/photos/${chapterId}/${imageName}`;
}

function toBrief(item: Record<string, unknown>): ComicBrief {
  const id = String(item.id ?? item.album_id ?? "");
  const cover =
    (item.image as string) ||
    (item.cover as string) ||
    (id ? coverUrl(id) : "");
  return {
    id,
    sourceKey: "jm",
    title: String(item.name ?? item.title ?? id),
    subTitle: Array.isArray(item.author)
      ? (item.author as string[]).join(", ")
      : String(item.author ?? ""),
    cover: cover.startsWith("http") ? cover : `${imgBase()}${cover}`,
    tags: Array.isArray(item.tags)
      ? (item.tags as string[])
      : typeof item.tags === "string"
        ? (item.tags as string).split(/[,，]/).map((s) => s.trim())
        : [],
    description: String(item.description ?? ""),
  };
}

function asList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["content", "list", "comics"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

/** After login PicaComic updateImgUrl via /setting?app_img_shunt= */
async function refreshImgHost(shunt = 1) {
  try {
    const data = (await jmRequest(
      "GET",
      `/setting?app_img_shunt=${shunt}`,
    )) as Record<string, unknown>;
    const host = data.img_host || data.imgHost;
    if (typeof host === "string" && host.startsWith("http")) {
      setSourceAccount("jm", { ...accountData(), imgBase: host.replace(/\/$/, "") });
    }
  } catch {
    // optional
  }
}

/**
 * PicaComic JmNetwork.getApiDomains + tryFetchAndDecrypt
 * GET remote txt → AES decrypt with domainSecret → JSON.Server[0..3]
 */
async function fetchRemoteDomains(): Promise<string[]> {
  let lastErr = "unknown";
  for (const url of JM_DOMAIN_URLS) {
    try {
      const res = await httpFetch(url, {
        method: "GET",
        headers: {
          "user-agent": JM_UA,
          Accept: "*/*",
        },
        retry: false,
        timeoutMs: 15_000,
      });
      const raw = (await res.text()).trim();
      if (!res.ok || !raw) {
        lastErr = `HTTP ${res.status} ${url}`;
        continue;
      }
      // body may be pure base64 ciphertext string
      const decoded = convertJmDataWithSecret(raw, JM_DOMAIN_SECRET) as {
        Server?: string[];
        server?: string[];
      };
      const list = (decoded.Server || decoded.server || [])
        .map((d) => String(d).replace(/^https?:\/\//, "").replace(/\/$/, ""))
        .filter(Boolean);
      // PicaComic keeps first 4
      const top = list.slice(0, 4);
      if (top.length) return top;
      lastErr = "empty Server list";
    } catch (e) {
      lastErr = (e as Error).message || String(e);
    }
  }
  throw new SourceError("DOMAIN_SYNC_FAILED", `同步 JM 域名失败: ${lastErr}`);
}

/**
 * PicaComic selectDomain: race POST /login with body "&", first 401 wins
 * (alive API node returns 401 for unauthenticated login)
 */
async function selectLiveDomainIndex(list: string[]): Promise<number> {
  if (!list.length) return 0;
  const time = String(Math.floor(Date.now() / 1000));
  const headers = apiHeaders(time, true);

  const probes = list.map((host, index) =>
    (async () => {
      const res = await httpFetch(`https://${host}/login`, {
        method: "POST",
        headers,
        body: "&",
        retry: false,
        timeoutMs: 8_000,
      });
      // alive node: 401 (need login) or 200 with encrypted body
      if (res.status === 401 || res.status === 200) return index;
      throw new Error(`status ${res.status}`);
    })(),
  );

  try {
    return await Promise.any(probes);
  } catch {
    return 0;
  }
}

/** Full sync: remote list → store → pick live stream → optional img host */
async function syncDomains(): Promise<{ message: string }> {
  const list = await fetchRemoteDomains();
  const liveIndex = await selectLiveDomainIndex(list);
  setSourceAccount("jm", {
    ...accountData(),
    domains: list,
    domainIndex: String(liveIndex),
    baseUrl: undefined,
    domainsSyncedAt: Date.now(),
  });
  // try refresh CDN with new API
  try {
    await refreshImgHost(1);
  } catch {
    // ignore
  }
  const active = list[liveIndex] || list[0];
  return {
    message: `已同步 ${list.length} 个 API 域名，当前分流: ${active}`,
  };
}

export const jm: ComicSourceAdapter = {
  key: "jm",
  name: "禁漫天堂",
  capabilities: {
    search: true,
    category: true,
    ranking: true,
    account: true,
    networkFavorites: true,
    comments: false,
    multiChapter: true,
  },
  imageHosts: ["cdn-msp", "jmapiproxy", "jmcomic", "18comic", "jmapinode"],
  // PicaComic searchNew `o=` order
  searchOptions: [
    { value: "mr", label: "最新" },
    { value: "mv", label: "总排行" },
    { value: "mv_m", label: "月排行" },
    { value: "mv_w", label: "周排行" },
    { value: "mv_t", label: "日排行" },
    { value: "mp", label: "最多图片" },
    { value: "tf", label: "最多爱心" },
  ],
  rankingOptions: [
    { value: "mv", label: "总排行" },
    { value: "mv_m", label: "月排行" },
    { value: "mv_w", label: "周排行" },
    { value: "mv_t", label: "日排行" },
  ],

  getAccountStatus(): AccountStatus {
    const acc = accountData();
    const loggedIn = Boolean(acc.uid || acc.name || acc.account);
    return {
      sourceKey: "jm",
      name: "禁漫天堂",
      loggedIn,
      allowReLogin: true,
      registerUrl: "https://18comic.vip/signup",
      loginMode: "password",
      description:
        "用户名密码登录；可用「同步域名」拉取官方线路并测活，再切换 API 分流；支持重新登录。",
      fields: [
        { key: "username", label: "用户名", type: "text", required: true },
        { key: "password", label: "密码", type: "password", required: true },
      ],
      infoItems: [
        ...(loggedIn
          ? [
              { title: "用户名", value: String(acc.name || acc.username || "—") },
              { title: "UID", value: String(acc.uid || "—") },
            ]
          : []),
        {
          title: "API",
          value: base().replace(/^https?:\/\//, ""),
        },
        {
          title: "图床",
          value: imgBase().replace(/^https?:\/\//, ""),
        },
        {
          title: "域名列表",
          value: `${domains().length} 个${acc.domainsSyncedAt ? ` · 已同步` : " · 内置"}`,
        },
      ],
      options: [
        {
          key: "domainIndex",
          label: "API 分流",
          type: "select",
          value: String(acc.domainIndex ?? "0"),
          choices: domains().map((d, i) => ({
            value: String(i),
            label: `${i + 1}. ${d}`,
          })),
        },
      ],
      actions: [
        {
          key: "syncDomains",
          label: "同步域名",
          hint: "从官方线路表拉取最新 API 域名并自动测活",
        },
      ],
    };
  },

  getExplorePages() {
    return [
      { key: "home", title: "禁漫主页", type: "mixed" },
      { key: "latest", title: "禁漫最新", type: "list" },
    ];
  },

  async loadExplore(pageKey, page) {
    try {
      if (pageKey === "latest") {
        // PicaComic getLatest: /latest?page=
        const data = await jmRequest("GET", `/latest?page=${page}`);
        return { items: asList(data).map(toBrief), maxPage: null };
      }
      // PicaComic getHomePage: /promote?page=0  (blocks with content[])
      if (page <= 1) {
        const data = await jmRequest("GET", `/promote?page=0`);
        const blocks = asList(data);
        const parts: { title: string; comics: ComicBrief[] }[] = [];
        for (const block of blocks) {
          const title = String(block.title ?? "推荐");
          const comics = asList(block.content ?? block.list ?? block).map(toBrief);
          if (comics.length) parts.push({ title, comics });
        }
        if (parts.length) return { parts } satisfies ExploreMixed;
      }
      // fallback latest stream
      const latest = await jmRequest("GET", `/latest?page=${page}`);
      return { items: asList(latest).map(toBrief), maxPage: null };
    } catch (e) {
      throw new SourceError(
        "FETCH_FAILED",
        `JM 探索失败（可在账号页切换 API 分流）: ${(e as Error).message}`,
      );
    }
  },

  async search(keyword, page, options = []) {
    // PicaComic searchNew: encode then + for spaces; o= order
    const order = options[0] || "mr";
    let q = keyword.trim().replace(/\s+/g, " ");
    q = encodeURIComponent(q).replace(/%20/g, "+");
    const path =
      page <= 1
        ? `/search?&search_query=${q}&o=${order}`
        : `/search?&search_query=${q}&o=${order}&page=${page}`;
    const data = (await jmRequest("GET", path)) as Record<string, unknown>;
    const list = asList(data.content ?? data);
    const total = Number(data.total ?? 0);
    const maxPage =
      list.length && total ? Math.ceil(total / list.length) : list.length ? null : 0;
    return { items: list.map(toBrief), maxPage } satisfies PageResult<ComicBrief>;
  },

  async getCategories() {
    try {
      const data = (await jmRequest("GET", `/categories`)) as Record<string, unknown>;
      const cats = (data.categories as { name?: string; slug?: string }[]) || [];
      return [
        {
          name: "分类",
          children: cats.map((c) => c.slug || c.name || "").filter(Boolean),
        },
      ];
    } catch {
      return [];
    }
  },

  async loadCategory(category, _param, options, page) {
    // PicaComic: /categories/filter?o=&c=&page=
    const order = options[0] || "mr";
    const data = (await jmRequest(
      "GET",
      `/categories/filter?o=${order}&c=${encodeURIComponent(category)}&page=${page}`,
    )) as Record<string, unknown>;
    const list = asList(data.content ?? data);
    const total = Number(data.total ?? 0);
    const maxPage =
      list.length && total ? Math.ceil(total / list.length) : null;
    return { items: list.map(toBrief), maxPage };
  },

  async loadRanking(option, page) {
    // PicaComic category filter order: mv / mv_m / mv_w / mv_t
    const order = option || "mv";
    const data = (await jmRequest(
      "GET",
      `/categories/filter?o=${order}&c=0&page=${page}`,
    )) as Record<string, unknown>;
    const list = asList(data.content ?? data);
    const total = Number(data.total ?? 0);
    return {
      items: list.map(toBrief),
      maxPage: list.length && total ? Math.ceil(total / list.length) : null,
    };
  },

  async loadComicInfo(id) {
    // PicaComic getComicInfo: /album?id=
    const data = (await jmRequest(
      "GET",
      `/album?id=${encodeURIComponent(id)}`,
    )) as Record<string, unknown>;
    const series =
      (data.series as { id: string | number; name?: string; sort?: string }[]) || [];
    const chapters: Record<string, string> = {};
    if (series.length) {
      let sort = 1;
      for (const s of series) {
        const name =
          (s.name && String(s.name).trim()) || `第${s.sort ?? sort}話`;
        chapters[String(s.id)] = name;
        sort++;
      }
    } else {
      chapters[id] = "第1话";
    }
    return {
      sourceKey: "jm",
      comicId: id,
      title: String(data.name ?? data.title ?? id),
      subTitle: Array.isArray(data.author)
        ? (data.author as string[]).join(", ")
        : String(data.author ?? ""),
      cover: String(data.image || data.cover || coverUrl(id)),
      description: String(data.description ?? ""),
      tags: {
        tags: Array.isArray(data.tags)
          ? (data.tags as string[])
          : String(data.tags || "")
              .split(/[,，]/)
              .filter(Boolean),
        works: Array.isArray(data.works) ? (data.works as string[]) : [],
        actors: Array.isArray(data.actors) ? (data.actors as string[]) : [],
      },
      chapters,
      isFavorite: Boolean(data.is_favorite ?? data.liked),
    } satisfies ComicInfo;
  },

  async loadComicPages(id, ep) {
    // PicaComic getChapter: /chapter?&id=  then getJmImageUrl
    const chapterId = String(ep || id);
    const data = (await jmRequest(
      "GET",
      `/chapter?&id=${encodeURIComponent(chapterId)}`,
    )) as Record<string, unknown>;
    const images =
      (data.images as string[]) || (data.photo as string[]) || [];
    const acc = accountData();
    const scrambleMap = (acc.scrambleMap as Record<string, string>) || {};
    // scramble key is album/chapter id used by scramble algorithm
    scrambleMap[chapterId] = String(data.id || chapterId);
    setSourceAccount("jm", { ...acc, scrambleMap });
    return images.map((img) => pageUrl(String(img), chapterId));
  },

  async login(payload: LoginPayload) {
    if (payload.username === "base" || payload.extra?.baseUrl) {
      setSourceAccount("jm", {
        ...accountData(),
        baseUrl: String(payload.extra?.baseUrl || payload.password),
      });
      return;
    }
    const username = payload.username?.trim();
    const password = payload.password ?? "";
    if (!username || !password) {
      throw new SourceError("BAD_REQUEST", "请填写用户名和密码");
    }

    // PicaComic: post /login username=&password=
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const data = (await jmRequest("POST", "/login", body)) as Record<string, unknown>;
    setSourceAccount("jm", {
      ...accountData(),
      account: [username, password],
      name: String(data.username ?? username),
      uid: String(data.uid ?? data.id ?? ""),
      // keep cookie from Set-Cookie; do NOT put fake Authorization bearer token
    });
    await refreshImgHost(1);
  },

  async reLogin() {
    const acc = accountData().account as string[] | undefined;
    if (!acc?.[0] || !acc?.[1]) {
      throw new SourceError("NO_DATA", "无保存的账号数据，无法重新登录");
    }
    await this.login!({ username: acc[0], password: acc[1] });
  },

  async logout() {
    const keep = {
      domainIndex: accountData().domainIndex,
      baseUrl: accountData().baseUrl,
      domains: accountData().domains,
      imgBase: accountData().imgBase,
      appVersion: accountData().appVersion,
    };
    clearSourceAccount("jm");
    if (
      keep.domainIndex != null ||
      keep.baseUrl ||
      keep.domains ||
      keep.imgBase
    ) {
      setSourceAccount("jm", keep);
    }
  },

  isLoggedIn() {
    const acc = accountData();
    return Boolean(acc.uid || (acc.account as string[] | undefined)?.[0]);
  },

  setAccountOption(key, value) {
    if (key === "domainIndex") {
      setSourceAccount("jm", {
        ...accountData(),
        domainIndex: String(value),
        baseUrl: undefined,
      });
    }
  },

  async runAccountAction(action) {
    if (action === "syncDomains") {
      return syncDomains();
    }
    throw new SourceError("UNSUPPORTED", `未知操作: ${action}`);
  },

  async getNetworkFavorites(page) {
    if (!this.isLoggedIn?.()) {
      throw new SourceError("NOT_LOGGED_IN", "请先登录禁漫");
    }
    // PicaComic getFolderComicsPage folder_id + o=
    const data = (await jmRequest(
      "GET",
      `/favorite?page=${page}&folder_id=0&o=mr`,
    )) as Record<string, unknown>;
    const list = asList(data.list ?? data.content ?? data);
    const total = Number(data.total ?? 0);
    const maxPage =
      list.length && total ? Math.ceil(total / list.length) : null;
    return { items: list.map(toBrief), maxPage };
  },

  async toggleNetworkFavorite(id, add) {
    if (!this.isLoggedIn?.()) {
      throw new SourceError("NOT_LOGGED_IN", "请先登录禁漫");
    }
    // PicaComic favorite(id, folder|null): POST /favorite aid= — response.type "add" means now favorited
    const body = `aid=${encodeURIComponent(id)}`;
    let data = (await jmRequest("POST", "/favorite", body)) as {
      type?: string;
    };
    // ensure desired state
    if (add && data.type !== "add") {
      data = (await jmRequest("POST", "/favorite", body)) as { type?: string };
    } else if (!add && data.type === "add") {
      await jmRequest("POST", "/favorite", body);
    }
  },

  getImageRequest(url) {
    return {
      url,
      headers: imgHeaders(),
    };
  },

  async transformImage(buffer, ctx) {
    const acc = accountData();
    const scrambleMap = (acc.scrambleMap as Record<string, string>) || {};
    const aid = scrambleMap[ctx.ep || ctx.comicId || ""] || ctx.comicId || "";
    if (!aid) return buffer;
    try {
      return await scrambleImage(buffer, aid);
    } catch {
      return buffer;
    }
  },
};
