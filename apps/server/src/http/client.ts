/**
 * Unified outbound HTTP for all source adapters / proxy / downloads.
 *
 * Library: **ky** — retry, timeout, hooks, fetch-compatible API
 * Transport: Node global fetch (undici) + optional ProxyAgent via setGlobalDispatcher
 *
 * Prefer `httpFetch` / `httpText` / `httpBuffer`, or the `http` ky instance.
 */
import ky, {
  type KyInstance,
  type Options as KyOptions,
  HTTPError,
} from "ky";
import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";

import { config } from "../config.ts";
import { getSetting } from "../db/index.ts";
import { log } from "../lib/log.ts";

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type FetchOptions = {
  method?: HttpMethod | string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array | null;
  /** Abort after ms (ky timeout). Default 30_000. */
  timeoutMs?: number;
  /**
   * Retry policy. `false` disables.
   * Default: 2 retries on GET/HEAD/OPTIONS for network errors & 408/429/5xx.
   * POST is not retried unless methods are overridden.
   */
  retry?: false | number | KyOptions["retry"];
  searchParams?: Record<string, string | number | boolean | undefined>;
  /**
   * When true, non-2xx throws HTTPError (ky default).
   * Default **false** so adapters can handle 401 etc.
   */
  throwHttpErrors?: boolean;
};

const DEFAULT_RETRY = {
  limit: 2,
  methods: ["get", "head", "options"] as string[],
  // 429: prefer host throttle + caller message over rapid retry storms
  statusCodes: [408, 413, 500, 502, 503, 504],
  delay: (attemptCount: number) => Math.min(1000 * 2 ** (attemptCount - 1), 8000),
} satisfies NonNullable<KyOptions["retry"]>;

/**
 * Soft rate-limit certain hosts (ms between requests).
 * PicaComic-style clients space requests; blasting APIs triggers 403/429.
 */
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  "nhentai.net": 400,
  "nhentai.to": 400,
  "e-hentai.org": 350,
  "exhentai.org": 350,
  "forums.e-hentai.org": 400,
  "api.e-hentai.org": 300,
  "picaapi.picacomic.com": 120,
  "jmapinodeudzn.net": 250,
  "jmapinode.xyz": 250,
  "jmapinode.vip": 250,
  "jmapiproxyxxx.vip": 250,
};

const hostLastAt = new Map<string, number>();
const hostChain = new Map<string, Promise<void>>();

function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function minIntervalFor(host: string): number {
  if (!host) return 0;
  if (HOST_MIN_INTERVAL_MS[host]) return HOST_MIN_INTERVAL_MS[host];
  for (const [suffix, ms] of Object.entries(HOST_MIN_INTERVAL_MS)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return ms;
  }
  return 0;
}

/** Serialize + space out requests to the same host when configured. */
async function throttleHost(url: string): Promise<void> {
  const host = hostKey(url);
  const minMs = minIntervalFor(host);
  if (!minMs) return;

  const prev = hostChain.get(host) ?? Promise.resolve();
  const next = prev.then(async () => {
    const last = hostLastAt.get(host) ?? 0;
    const wait = minMs - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    hostLastAt.set(host, Date.now());
  });
  // keep chain alive even if a waiter fails
  hostChain.set(
    host,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  await next;
}

let lastProxyUrl: string | undefined | null = null;

/**
 * Apply outbound proxy from settings (preferred) or env.
 * Empty/cleared value resets to a default undici Agent (no proxy).
 */
export function applyHttpProxyFromSettings(httpProxy?: string) {
  const fromArg = httpProxy?.trim() || "";
  // explicit empty string from settings clear wins over env only when caller
  // passes "" after UI clear — treat undefined as "fall back to env"
  const url =
    httpProxy === ""
      ? undefined
      : (fromArg || config.httpProxy || "").trim() || undefined;
  if (url === lastProxyUrl) return;
  lastProxyUrl = url;
  if (url) {
    setGlobalDispatcher(new ProxyAgent(url));
  } else {
    setGlobalDispatcher(new Agent());
  }
}

function ensureProxy() {
  const s = getSetting<{ httpProxy?: string }>("app", {});
  // missing key → fall back to env; empty string → clear proxy
  applyHttpProxyFromSettings(
    "httpProxy" in s ? (s.httpProxy ?? "") : undefined,
  );
}

function normalizeRetry(
  retry: FetchOptions["retry"],
  fallback: typeof DEFAULT_RETRY = DEFAULT_RETRY,
): KyOptions["retry"] {
  if (retry === false) return 0;
  if (typeof retry === "number") {
    return { ...fallback, limit: retry };
  }
  if (retry && typeof retry === "object") {
    return { ...fallback, ...retry };
  }
  return fallback;
}

/** Shared ky instance — helpers go through this */
export const http: KyInstance = ky.create({
  timeout: 30_000,
  throwHttpErrors: false,
  retry: DEFAULT_RETRY,
  headers: {
    "user-agent": DEFAULT_UA,
  },
  hooks: {
    beforeRetry: [
      ({ request, error, retryCount }) => {
        log.debug(
          `[http] retry #${retryCount} ${request.method} ${request.url}`,
          error?.message ?? "",
        );
      },
    ],
  },
});

function toKyOptions(options: FetchOptions = {}): KyOptions {
  const out: KyOptions = {
    method: (options.method ?? "GET") as KyOptions["method"],
    headers: options.headers,
    body: (options.body ?? undefined) as KyOptions["body"],
    searchParams: options.searchParams as KyOptions["searchParams"],
  };
  if (options.timeoutMs !== undefined) out.timeout = options.timeoutMs;
  if (options.retry !== undefined) out.retry = normalizeRetry(options.retry);
  // only set when explicit — undefined would override instance default (false → true)
  if (options.throwHttpErrors !== undefined) {
    out.throwHttpErrors = options.throwHttpErrors;
  }
  return out;
}

/** Raw Response. Non-2xx does not throw by default. */
export async function httpFetch(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  // Lazy: do not open SQLite at import time (breaks parallel tests / pure imports)
  ensureProxy();
  await throttleHost(url);
  return http(url, toKyOptions(options));
}

export async function httpText(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const res = await httpFetch(url, { ...options, throwHttpErrors: false });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return text;
}

export async function httpBuffer(
  url: string,
  options: FetchOptions = {},
): Promise<{ buffer: Buffer; contentType: string; status: number }> {
  const res = await httpFetch(url, {
    ...options,
    // images: 1 retry by default
    retry: options.retry === undefined ? 1 : options.retry,
    throwHttpErrors: false,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    status: res.status,
  };
}

export { HTTPError, type KyInstance, type KyOptions };
