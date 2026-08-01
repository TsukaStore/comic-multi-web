/**
 * picacg — PicaComic aligned
 * headers.dart + methods.dart
 */
import { createHmac, randomUUID } from "node:crypto";

import type { AccountStatus, ComicBrief, ComicInfo, ExploreMixed, PageResult } from "../../domain/models.ts";

import { clearSourceAccount, getSourceAccount, setSourceAccount } from "../../db/index.ts";
import { httpFetch } from "../../http/client.ts";
import type { ComicSourceAdapter, LoginPayload } from "../adapter.ts";
import { SourceError } from "../adapter.ts";

const API = "https://picaapi.picacomic.com";
const API_KEY = "C69BAF41DA5ABD1FFEDC6D2FEA56B";
/** PicaComic HMAC secret (byte-identical string) */
const HMAC_KEY =
  '~d}$Q7$eIni=V)9\\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn';

function nonce() {
  return randomUUID().replace(/-/g, "");
}

function signature(path: string, time: string, n: string, method: string) {
  // path + time + nonce + method + apiKey, lowercased — then HMAC-SHA256
  const raw = (path + time + n + method + API_KEY).toLowerCase();
  return createHmac("sha256", Buffer.from(HMAC_KEY, "utf8")).update(raw).digest("hex");
}

function accountData() {
  return getSourceAccount("picacg") || {};
}

function getToken(): string {
  return (accountData().token as string) || "";
}

async function picaRequest(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown> | null,
  requireAuth = true,
  tokenOverride?: string,
) {
  const token = tokenOverride ?? getToken();
  if (requireAuth && !token) {
    throw new SourceError("NOT_LOGGED_IN", "picacg 未登录");
  }
  const time = String(Math.floor(Date.now() / 1000));
  const n = nonce();
  // signature path: no leading slash (PicaComic)
  const urlPath = path.replace(/^\//, "");
  const sig = signature(urlPath, time, n, method);
  const headers: Record<string, string> = {
    "api-key": API_KEY,
    accept: "application/vnd.picacomic.com.v1+json",
    "app-channel": String(accountData().appChannel ?? "3"),
    time,
    nonce: n,
    "app-version": "2.2.1.3.3.4",
    "app-uuid": "defaultUuid",
    "image-quality": String(accountData().imageQuality ?? "original"),
    "app-platform": "android",
    "app-build-version": "45",
    "Content-Type": "application/json; charset=UTF-8",
    "user-agent": "okhttp/3.8.1",
    version: "v1.4.1",
    Host: "picaapi.picacomic.com",
    signature: sig,
  };
  if (token) headers.authorization = token;

  const res = await httpFetch(`${API}/${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    retry: false,
    timeoutMs: 20_000,
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new SourceError("BAD_RESPONSE", `picacg invalid JSON (${res.status})`);
  }

  if (res.status === 401 && requireAuth) {
    const acc = accountData().account as string[] | undefined;
    if (acc?.[0] && acc?.[1] && !tokenOverride) {
      await picacg.reLogin?.();
      return picaRequest(method, path, body, requireAuth, getToken());
    }
    throw new SourceError("AUTH_EXPIRED", "登录失效，请重新登录");
  }
  if (res.status !== 200) {
    const msg =
      (json.message as string) || (json.error as string) || `HTTP ${res.status}`;
    throw new SourceError("API_ERROR", msg);
  }
  return json;
}

/** thumb: fileServer + /static/ + path (PicaComic common pattern) */
function thumbUrl(thumb: { fileServer?: string; path?: string } | undefined) {
  if (!thumb?.fileServer || !thumb?.path) return "";
  const server = thumb.fileServer.replace(/\/$/, "");
  const p = thumb.path.replace(/^\//, "");
  if (p.startsWith("static/")) return `${server}/${p}`;
  return `${server}/static/${p}`;
}

function docToBrief(doc: Record<string, unknown>): ComicBrief {
  const thumb = doc.thumb as { fileServer?: string; path?: string } | undefined;
  const tags = [
    ...((doc.tags as string[]) ?? []),
    ...((doc.categories as string[]) ?? []),
  ];
  return {
    id: String(doc._id),
    sourceKey: "picacg",
    title: String(doc.title ?? "Unknown"),
    subTitle: String(doc.author ?? ""),
    cover: thumbUrl(thumb),
    tags,
    description: "",
    pageCount: typeof doc.pagesCount === "number" ? doc.pagesCount : undefined,
  };
}

async function fetchAndStoreProfile(token?: string) {
  const res = await picaRequest("GET", "users/profile", null, true, token);
  const user = (res.data as { user: Record<string, unknown> }).user;
  const avatar = user.avatar as { fileServer?: string; path?: string } | undefined;
  const profile = {
    id: String(user._id ?? ""),
    email: String(user.email ?? ""),
    name: String(user.name ?? ""),
    level: Number(user.level ?? 0),
    exp: Number(user.exp ?? 0),
    title: String(user.title ?? ""),
    slogan: String(user.slogan ?? ""),
    isPunched: Boolean(user.isPunched),
    avatar: avatar ? thumbUrl(avatar) : "",
  };
  const prev = accountData();
  setSourceAccount("picacg", { ...prev, user: profile, token: token ?? prev.token });
  return profile;
}

export const picacg: ComicSourceAdapter = {
  key: "picacg",
  name: "picacg",
  capabilities: {
    search: true,
    category: true,
    ranking: true,
    account: true,
    networkFavorites: true,
    comments: true,
    multiChapter: true,
  },
  imageHosts: ["picacomic.com", "storage.diwodiwo.xyz", "s3.", "wikawika.xyz"],
  // PicaComic advanced-search sort codes
  searchOptions: [
    { value: "dd", label: "新到旧" },
    { value: "da", label: "旧到新" },
    { value: "ld", label: "最多爱心" },
    { value: "vd", label: "最多指名" },
  ],
  rankingOptions: [
    { value: "H24", label: "日榜" },
    { value: "D7", label: "周榜" },
    { value: "D30", label: "月榜" },
  ],

  getAccountStatus(): AccountStatus {
    const data = accountData();
    const user = data.user as
      | {
          email?: string;
          name?: string;
          level?: number;
          title?: string;
          exp?: number;
          slogan?: string;
        }
      | undefined;
    const loggedIn = Boolean(data.token);
    return {
      sourceKey: "picacg",
      name: "picacg",
      loggedIn,
      allowReLogin: true,
      registerUrl: "https://manhuabika.com/",
      loginMode: "password",
      description: "邮箱 + 密码登录，保存 token 与资料，支持重新登录。",
      fields: [
        {
          key: "username",
          label: "账号",
          type: "text",
          required: true,
          placeholder: "邮箱 / 账号",
        },
        {
          key: "password",
          label: "密码",
          type: "password",
          required: true,
        },
      ],
      infoItems: loggedIn
        ? [
            { title: "账号", value: user?.email || "—" },
            { title: "用户名", value: user?.name || "—" },
            {
              title: "等级",
              value: `Lv${user?.level ?? 0} ${user?.title ?? ""} Exp${user?.exp ?? 0}`,
            },
            { title: "简介", value: user?.slogan || "—" },
          ]
        : [],
    };
  },

  getExplorePages() {
    return [{ key: "home", title: "探索", type: "multipart" }];
  },

  async loadExplore(_pageKey, page) {
    // page>1: latest list only (PicaComic “更多”)
    if (page > 1) {
      const latest = await picaRequest("GET", `comics?page=${page}&s=dd`);
      const data = latest.data as {
        comics: { docs: Record<string, unknown>[]; pages?: number };
      };
      return {
        items: data.comics.docs.map(docToBrief),
        maxPage: data.comics.pages ?? null,
      };
    }
    // home: collections (官方推荐块) + random + latest — sequential to avoid 429
    const parts: { title: string; comics: ComicBrief[]; viewMore?: string }[] = [];
    try {
      const colRes = await picaRequest("GET", "collections");
      const collections =
        (colRes.data as { collections?: { title?: string; comics?: Record<string, unknown>[] }[] })
          .collections || [];
      for (const col of collections) {
        const comics = (col.comics || []).map(docToBrief);
        if (comics.length) {
          parts.push({ title: col.title || "精选", comics });
        }
      }
    } catch {
      // collections optional
    }
    try {
      const randomRes = await picaRequest("GET", "comics/random");
      const random = (
        (randomRes.data as { comics: Record<string, unknown>[] }).comics || []
      ).map(docToBrief);
      if (random.length) parts.push({ title: "随机", comics: random });
    } catch {
      // optional
    }
    const latestRes = await picaRequest("GET", "comics?page=1&s=dd");
    const latest = (
      latestRes.data as { comics: { docs: Record<string, unknown>[] } }
    ).comics.docs.map(docToBrief);
    parts.push({ title: "最新", comics: latest, viewMore: "category:latest" });
    return { parts } satisfies ExploreMixed;
  },

  async search(keyword, page, options = []) {
    const sort = options[0] || "dd";
    const res = await picaRequest("POST", `comics/advanced-search?page=${page}`, {
      keyword,
      sort,
    });
    const comics = (res.data as { comics: { docs: Record<string, unknown>[]; pages: number } })
      .comics;
    return {
      items: comics.docs.map(docToBrief),
      maxPage: comics.pages,
    } satisfies PageResult<ComicBrief>;
  },

  async getCategories() {
    try {
      const res = await picaRequest("GET", "categories");
      const cats =
        (res.data as { categories?: { title?: string; name?: string }[] }).categories ||
        [];
      const children = cats
        .map((c) => c.title || c.name || "")
        .filter(Boolean);
      if (children.length) {
        return [{ name: "分类", children }];
      }
    } catch {
      // fallback static list
    }
    return [
      {
        name: "分类",
        children: [
          "大家都在看",
          "全彩",
          "長篇",
          "同人",
          "短篇",
          "純愛",
          "百合花園",
          "耽美花園",
          "單行本",
          "WEBTOON",
          "Cosplay",
        ],
      },
    ];
  },

  async loadCategory(category, _param, options, page) {
    if (category === "random") {
      const res = await picaRequest("GET", "comics/random");
      const comics = (res.data as { comics: Record<string, unknown>[] }).comics;
      return { items: comics.map(docToBrief), maxPage: 1 };
    }
    if (category === "latest") {
      const res = await picaRequest("GET", `comics?page=${page}&s=dd`);
      const comics = (res.data as { comics: { docs: Record<string, unknown>[]; pages: number } })
        .comics;
      return { items: comics.docs.map(docToBrief), maxPage: comics.pages };
    }
    const sort = options[0] || "dd";
    const res = await picaRequest(
      "GET",
      `comics?page=${page}&c=${encodeURIComponent(category)}&s=${sort}`,
    );
    const comics = (res.data as { comics: { docs: Record<string, unknown>[]; pages: number } })
      .comics;
    return { items: comics.docs.map(docToBrief), maxPage: comics.pages };
  },

  async loadRanking(option) {
    const res = await picaRequest(
      "GET",
      `comics/leaderboard?tt=${option || "H24"}&ct=VC`,
    );
    const comics = (res.data as { comics: Record<string, unknown>[] }).comics;
    return { items: comics.map(docToBrief), maxPage: 1 };
  },

  async loadComicInfo(id) {
    const res = await picaRequest("GET", `comics/${id}`);
    const comic = (res.data as { comic: Record<string, unknown> }).comic;
    const eps: string[] = [];
    let page = 1;
    let total = 1;
    while (page <= total) {
      const er = await picaRequest("GET", `comics/${id}/eps?page=${page}`);
      const ed = (er.data as { eps: { docs: { title: string }[]; pages: number } }).eps;
      total = ed.pages;
      for (const d of ed.docs) eps.push(d.title);
      page++;
    }
    const chapters: Record<string, string> = {};
    eps.reverse().forEach((title, i) => {
      chapters[String(i + 1)] = title;
    });
    return {
      sourceKey: "picacg",
      comicId: id,
      title: String(comic.title ?? ""),
      subTitle: String(comic.author ?? ""),
      cover: thumbUrl(comic.thumb as { fileServer?: string; path?: string }),
      description: String(comic.description ?? ""),
      tags: {
        categories: (comic.categories as string[]) ?? [],
        tags: (comic.tags as string[]) ?? [],
      },
      chapters,
      pageCount: comic.pagesCount as number | undefined,
      isFavorite: comic.isFavourite as boolean | undefined,
    } satisfies ComicInfo;
  },

  async loadComicPages(id, ep) {
    const order = Number(ep || "1") || 1;
    const urls: string[] = [];
    let page = 1;
    let total = 1;
    while (page <= total) {
      const res = await picaRequest(
        "GET",
        `comics/${id}/order/${order}/pages?page=${page}`,
      );
      const pages = (
        res.data as {
          pages: {
            docs: { media: { fileServer: string; path: string } }[];
            pages: number;
          };
        }
      ).pages;
      total = pages.pages;
      for (const d of pages.docs) urls.push(thumbUrl(d.media));
      page++;
    }
    return urls;
  },

  async login(payload: LoginPayload) {
    const username = payload.username?.trim();
    const password = payload.password ?? "";
    if (!username || !password) {
      throw new SourceError("BAD_REQUEST", "请填写账号和密码");
    }

    const time = String(Math.floor(Date.now() / 1000));
    const n = nonce();
    const path = "auth/sign-in";
    const sig = signature(path, time, n, "POST");
    const res = await httpFetch(`${API}/${path}`, {
      method: "POST",
      headers: {
        "api-key": API_KEY,
        accept: "application/vnd.picacomic.com.v1+json",
        "app-channel": String(accountData().appChannel ?? "3"),
        time,
        nonce: n,
        "app-version": "2.2.1.3.3.4",
        "app-uuid": "defaultUuid",
        "image-quality": String(accountData().imageQuality ?? "original"),
        "app-platform": "android",
        "app-build-version": "45",
        "Content-Type": "application/json; charset=UTF-8",
        "user-agent": "okhttp/3.8.1",
        version: "v1.4.1",
        Host: "picaapi.picacomic.com",
        signature: sig,
      },
      body: JSON.stringify({ email: username, password }),
      retry: false,
    });
    const json = (await res.json()) as {
      message?: string;
      data?: { token?: string };
    };
    if (!res.ok || !json.data?.token) {
      throw new SourceError("LOGIN_FAILED", json.message || "登录失败");
    }
    const token = json.data.token;
    setSourceAccount("picacg", {
      token,
      account: [username, password],
      appChannel: "3",
      imageQuality: "original",
    });
    try {
      await fetchAndStoreProfile(token);
    } catch {
      // profile optional after login; keep token
    }
  },

  async reLogin() {
    const acc = accountData().account as string[] | undefined;
    if (!acc?.[0] || !acc?.[1]) {
      throw new SourceError("NO_DATA", "无保存的账号数据，无法重新登录");
    }
    await this.login!({ username: acc[0], password: acc[1] });
  },

  async logout() {
    clearSourceAccount("picacg");
  },

  isLoggedIn() {
    return Boolean(getToken());
  },

  async getNetworkFavorites(page) {
    const res = await picaRequest("GET", `users/favourite?s=dd&page=${page}`);
    const comics = (res.data as { comics: { docs: Record<string, unknown>[]; pages: number } })
      .comics;
    return { items: comics.docs.map(docToBrief), maxPage: comics.pages };
  },

  async toggleNetworkFavorite(id, add) {
    // picacg favourite endpoint is a toggle; hit until state matches `add`
    // First call flips state; if we need the opposite of resulting isFavourite, call again.
    // Without reading state, assume caller passes desired action based on current UI:
    // when add=true we only want to favorite (if already fav, one call would unfav — so only call when needed).
    // Convention used by comic page: toggleNetworkFavorite(id, !fav) after reading isFavorite.
    await picaRequest("POST", `comics/${id}/favourite`, {});
    // If server returns new state we could verify — API body is empty toggle.
    void add;
  },

  getImageRequest(url) {
    return {
      url,
      headers: {
        "user-agent": "okhttp/3.8.1",
        referer: "https://www.picacomic.com/",
      },
    };
  },
};
