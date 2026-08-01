import * as cheerio from "cheerio";

import type { AccountStatus, ComicBrief, ComicInfo, ExploreMixed, PageResult } from "../../domain/models.ts";

import { clearSourceAccount, getSourceAccount, setSourceAccount } from "../../db/index.ts";
import { DEFAULT_UA, httpFetch, httpText } from "../../http/client.ts";
import type { ComicSourceAdapter, LoginPayload } from "../adapter.ts";
import { SourceError } from "../adapter.ts";

function accountData() {
  return getSourceAccount("ehentai") || {};
}

function baseUrl() {
  const site = (accountData().site as string) || "e-hentai";
  return site === "exhentai" ? "https://exhentai.org" : "https://e-hentai.org";
}

function ua() {
  return (accountData().ua as string) || DEFAULT_UA;
}

/** PicaComic getCookies(setNW): always include nw=1 for content warning skip */
function cookieHeader(setNW = true): string {
  const acc = accountData();
  const map: Record<string, string> = {};
  if (typeof acc.cookie === "string" && acc.cookie.trim()) {
    for (const part of acc.cookie.split(/[;\n]/)) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  for (const k of ["ipb_member_id", "ipb_pass_hash", "igneous", "sk", "star"]) {
    if (acc[k]) map[k] = String(acc[k]);
  }
  map.nw = setNW ? "1" : "0";
  return Object.entries(map)
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function parseCookieString(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[;\n]/)) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function assertHtmlOk(html: string) {
  if (!html || html.length < 50) {
    throw new SourceError(
      "NO_PERMISSION",
      "ehentai 返回空页面（无权限/Cookie 无效）",
    );
  }
  if (html.startsWith("Your") && /banned|IP address/i.test(html)) {
    throw new SourceError("BANNED", "Your IP address has been temporarily banned");
  }
  if (/bounce_login\.php/i.test(html)) {
    throw new SourceError("NOT_LOGGED_IN", "未登录或登录到期");
  }
}

/** PicaComic request(): webUA + Host + Cookie */
async function fetchHtml(path: string, setNW = true) {
  const url = path.startsWith("http") ? path : `${baseUrl()}${path}`;
  const host = new URL(url).host;
  try {
    const html = await httpText(url, {
      headers: {
        "User-Agent": ua(),
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.6",
        Cookie: cookieHeader(setNW),
        Referer: `${baseUrl()}/`,
        Host: host,
      },
      retry: false,
      timeoutMs: 20_000,
    });
    assertHtmlOk(html);
    return html;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError("FETCH_FAILED", `ehentai: ${(e as Error).message}`);
  }
}

async function validateLogin(): Promise<boolean> {
  try {
    const html = await fetchHtml("/");
    if (html.includes("bounce_login.php") && !cookieHeader().includes("ipb_member_id")) {
      return false;
    }
    if (html.includes("This site requires") || html.length < 200) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseList(html: string): PageResult<ComicBrief> {
  const $ = cheerio.load(html);
  const items: ComicBrief[] = [];

  $("table.itg tr").each((_, el) => {
    const glname = $(el).find(".glname a").first();
    const href = glname.attr("href");
    if (!href) return;
    const m = href.match(/\/g\/(\d+)\/([0-9a-f]+)/i);
    if (!m) return;
    const title = glname.text().trim();
    const img = $(el).find(".glthumb img, .gl1e img, td.gl2c img").first();
    const cover = img.attr("data-src") || img.attr("src") || "";
    const tags: string[] = [];
    $(el)
      .find(".gt, .gtl")
      .each((_i, t) => {
        const titleAttr = $(t).attr("title") || $(t).text();
        if (titleAttr) tags.push(titleAttr.replace(/^[^:]+:/, "").trim());
      });
    items.push({
      id: `${m[1]}/${m[2]}`,
      sourceKey: "ehentai",
      title,
      subTitle: "",
      cover,
      tags: tags.slice(0, 10),
      description: "",
    });
  });

  if (items.length === 0) {
    $(".gl1t").each((_, el) => {
      const a = $(el).find("a").first();
      const href = a.attr("href") || "";
      const m = href.match(/\/g\/(\d+)\/([0-9a-f]+)/i);
      if (!m) return;
      const title = $(el).find(".gl4t, .glink").text().trim() || a.text().trim();
      const img = $(el).find("img").first();
      items.push({
        id: `${m[1]}/${m[2]}`,
        sourceKey: "ehentai",
        title,
        subTitle: "",
        cover: img.attr("data-src") || img.attr("src") || "",
        tags: [],
        description: "",
      });
    });
  }

  let maxPage: number | null = null;
  const last = $(".ptt td a").last().attr("href");
  if (last) {
    const pm = last.match(/[?&]page=(\d+)/);
    if (pm) maxPage = Number(pm[1]) + 1;
  }

  return { items, maxPage };
}

export const ehentai: ComicSourceAdapter = {
  key: "ehentai",
  name: "E-Hentai",
  capabilities: {
    search: true,
    category: false,
    ranking: false,
    account: true,
    networkFavorites: true,
    comments: false,
    multiChapter: false,
  },
  imageHosts: ["e-hentai.org", "exhentai.org", "ehgt.org", "hath.network"],
  // EH list is relevance / date via site default; no simple sort API here
  searchOptions: [],

  getAccountStatus(): AccountStatus {
    const acc = accountData();
    const loggedIn = Boolean(acc.ipb_member_id && acc.ipb_pass_hash);
    return {
      sourceKey: "ehentai",
      name: "E-Hentai",
      loggedIn,
      allowReLogin: false,
      registerUrl: "https://forums.e-hentai.org/index.php?act=Reg&CODE=00",
      loginMode: "cookie_fields",
      description:
        "填写 ipb_member_id / ipb_pass_hash（可粘贴完整 Cookie 解析），可选 igneous 用于 exhentai。",
      fields: [
        {
          key: "ipb_member_id",
          label: "ipb_member_id",
          type: "text",
          required: true,
        },
        {
          key: "ipb_pass_hash",
          label: "ipb_pass_hash",
          type: "password",
          required: true,
        },
        {
          key: "igneous",
          label: "igneous（非必要，ex 需要）",
          type: "text",
          required: false,
        },
        {
          key: "star",
          label: "star（非必要）",
          type: "text",
          required: false,
        },
        {
          key: "cookie",
          label: "或粘贴完整 Cookie",
          type: "textarea",
          required: false,
          placeholder: "ipb_member_id=...; ipb_pass_hash=...; igneous=...",
          hint: "粘贴后会自动解析字段",
        },
      ],
      infoItems: loggedIn
        ? [
            { title: "状态", value: "已登录" },
            { title: "ipb_member_id", value: String(acc.ipb_member_id) },
            {
              title: "igneous",
              value: acc.igneous ? String(acc.igneous) : "（未设置）",
            },
            {
              title: "站点",
              value: (acc.site as string) === "exhentai" ? "exhentai.org" : "e-hentai.org",
            },
          ]
        : [],
      options: [
        {
          key: "site",
          label: "画廊站点",
          type: "select",
          value: (acc.site as string) || "e-hentai",
          choices: [
            { value: "e-hentai", label: "e-hentai.org" },
            { value: "exhentai", label: "exhentai.org" },
          ],
        },
      ],
    };
  },

  getExplorePages() {
    return [
      { key: "home", title: "Eh主页", type: "list" },
      { key: "popular", title: "Eh热门", type: "list" },
    ];
  },

  async loadExplore(pageKey, page) {
    const path =
      pageKey === "popular"
        ? `/popular${page > 1 ? `?page=${page - 1}` : ""}`
        : page <= 1
          ? "/"
          : `/?page=${page - 1}`;
    const html = await fetchHtml(path);
    const list = parseList(html);
    return { items: list.items, maxPage: list.maxPage } satisfies ExploreMixed;
  },

  async search(keyword, page) {
    const q = encodeURIComponent(keyword);
    const html = await fetchHtml(
      `/?f_search=${q}${page > 1 ? `&page=${page - 1}` : ""}`,
    );
    return parseList(html);
  },

  async loadComicInfo(id) {
    const [gid, token] = id.split("/");
    const html = await fetchHtml(`/g/${gid}/${token}/`);
    const $ = cheerio.load(html);
    const title = $("#gn").text().trim() || $("h1").first().text().trim();
    const subTitle = $("#gj").text().trim();
    const cover =
      $("#gd1 img").attr("src") ||
      $("#gd1 div").attr("style")?.match(/url\(([^)]+)\)/)?.[1] ||
      "";
    const tags: Record<string, string[]> = {};
    $("#taglist tr").each((_, el) => {
      const cat = $(el).find(".tc").text().replace(":", "").trim();
      const vals: string[] = [];
      $(el)
        .find("a")
        .each((_i, a) => {
          vals.push($(a).text().trim());
        });
      if (cat) tags[cat] = vals;
    });
    const pageText = $("#gdd tr")
      .filter(
        (_, el) =>
          $(el).text().includes("Length") || $(el).text().includes("页"),
      )
      .text();
    const pageCount = Number(pageText.match(/(\d+)/)?.[1] || 0) || undefined;
    // PicaComic: " Add to Favorites" means not favorited
    const favLink = $("#favoritelink").text();
    const isFavorite =
      this.isLoggedIn?.() &&
      Boolean(favLink) &&
      !favLink.includes("Add to Favorites");
    return {
      sourceKey: "ehentai",
      comicId: id,
      title,
      subTitle: subTitle || undefined,
      cover,
      tags,
      pageCount,
      chapters: { "1": "阅读" },
      isFavorite: this.isLoggedIn?.() ? isFavorite : undefined,
    } satisfies ComicInfo;
  },

  async loadComicPages(id) {
    // PicaComic: _getReaderLinks (gdt anchors) → open each /s/... page → div#i3 > a > img
    // Sequential (host throttle) — never blast gallery image pages in parallel
    const [gid, token] = id.split("/");
    const gLink = `/g/${gid}/${token}/`;
    const readerLinks: string[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const path = page === 0 ? gLink : `${gLink}?p=${page}`;
      const html = await fetchHtml(path);
      const $ = cheerio.load(html);
      if (page === 0) {
        const last = $("table.ptt td a").last().attr("href");
        const m = last?.match(/[?&]p=(\d+)/);
        totalPages = m ? Number(m[1]) + 1 : 1;
      }
      // PicaComic: div#gdt > a
      $("div#gdt > a, #gdt a").each((_, el) => {
        const href = $(el).attr("href");
        if (href && !readerLinks.includes(href)) readerLinks.push(href);
      });
      page++;
    }

    const urls: string[] = [];
    for (const link of readerLinks) {
      const pageHtml = await fetchHtml(link);
      const $$ = cheerio.load(pageHtml);
      // PicaComic getImageLinkWithNL: div#i3 > a > img
      const src =
        $$("div#i3 > a > img").attr("src") ||
        $$("div#i3 img").attr("src") ||
        $$("#img").attr("src") ||
        $$("img#img").attr("src");
      if (src) urls.push(src);
    }
    return urls;
  },

  async login(payload: LoginPayload) {
    let cookies = { ...(payload.cookies || {}) };
    if (payload.cookie) {
      cookies = { ...cookies, ...parseCookieString(payload.cookie) };
    }
    // also accept field keys at top level via username/password misuse avoided —
    // frontend sends cookies map
    const id = cookies.ipb_member_id || payload.username;
    const hash = cookies.ipb_pass_hash || payload.password;
    if (!id || !hash) {
      throw new SourceError(
        "BAD_REQUEST",
        "请填写 ipb_member_id 与 ipb_pass_hash（或粘贴完整 Cookie）",
      );
    }

    const next = {
      ...accountData(),
      ipb_member_id: id,
      ipb_pass_hash: hash,
      igneous: cookies.igneous || "",
      star: cookies.star || "",
      sk: cookies.sk || "",
      cookie: [
        `ipb_member_id=${id}`,
        `ipb_pass_hash=${hash}`,
        cookies.igneous ? `igneous=${cookies.igneous}` : "",
        cookies.star ? `star=${cookies.star}` : "",
        cookies.sk ? `sk=${cookies.sk}` : "",
        "nw=1",
      ]
        .filter(Boolean)
        .join("; "),
      site: (payload.extra?.site as string) || (accountData().site as string) || "e-hentai",
    };
    setSourceAccount("ehentai", next);

    const ok = await validateLogin();
    if (!ok) {
      // keep cookies but warn — exhentai may need igneous
      if (next.site === "exhentai" && !next.igneous) {
        throw new SourceError(
          "LOGIN_FAILED",
          "exhentai 需要有效 igneous，请从浏览器 Cookie 复制",
        );
      }
      // soft fail for e-hentai if network blocked
    }
  },

  async logout() {
    clearSourceAccount("ehentai");
  },

  isLoggedIn() {
    const acc = accountData();
    return Boolean(acc.ipb_member_id && acc.ipb_pass_hash);
  },

  setAccountOption(key, value) {
    if (key === "site") {
      setSourceAccount("ehentai", {
        ...accountData(),
        site: String(value),
      });
    }
  },

  async getNetworkFavorites(page) {
    if (!this.isLoggedIn?.()) {
      throw new SourceError("NOT_LOGGED_IN", "请先登录 E-Hentai");
    }
    const html = await fetchHtml(
      `/favorites.php${page > 1 ? `?page=${page - 1}` : ""}`,
    );
    return parseList(html);
  },

  async toggleNetworkFavorite(id, add) {
    if (!this.isLoggedIn?.()) {
      throw new SourceError("NOT_LOGGED_IN", "请先登录 E-Hentai");
    }
    const [gid, token] = id.split("/");
    if (!gid || !token) {
      throw new SourceError("BAD_REQUEST", "无效的画廊 ID");
    }
    // PicaComic favorite / unfavorite via gallerypopups.php
    const site = baseUrl();
    const body = add
      ? "favcat=0&favnote=&apply=Add+to+Favorites&update=1"
      : "favcat=favdel&favnote=&apply=Apply+Changes&update=1";
    const res = await httpFetch(
      `${site}/gallerypopups.php?gid=${encodeURIComponent(gid)}&t=${encodeURIComponent(token)}&act=addfav`,
      {
        method: "POST",
        headers: {
          "User-Agent": ua(),
          Cookie: cookieHeader(true),
          Referer: `${site}/g/${gid}/${token}/`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        retry: false,
        timeoutMs: 20_000,
      },
    );
    if (!res.ok) {
      throw new SourceError(
        "API_ERROR",
        `E-Hentai 收藏失败 HTTP ${res.status}`,
      );
    }
  },

  getImageRequest(url) {
    return {
      url,
      headers: {
        "User-Agent": ua(),
        Cookie: cookieHeader(true),
        Referer: `${baseUrl()}/`,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    };
  },
};
