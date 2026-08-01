/**
 * Hono RPC client + envelope unwrap.
 * Pages call `unwrap(client.....$get/post(...))` directly — no facade layer.
 */
import { hc } from "hono/client";
import type { AppType } from "server/rpc";

const TOKEN_KEY = "cmw_app_token";

export function getAppToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAppToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / denied */
  }
}

function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getAppToken();
  if (token) headers.set("x-app-token", token);
  return fetch(input, { ...init, headers, credentials: "include" });
}

export const client = hc<AppType>("/api", { fetch: appFetch });

/** Domain types (single source: server models via rpc entry) */
export type {
  AccountStatus,
  AppSettings,
  ComicBrief,
  ComicInfo,
  DownloadTask,
  FavoriteItem,
  HistoryItem,
  LogLevel,
  SearchOption,
} from "server/rpc";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type OkData<T> = T extends { ok: true; data: infer D }
  ? D
  : T extends { ok: false }
    ? never
    : never;

type JsonBodyOf<R> = R extends { json(): Promise<infer T> } ? T : never;

function isEnvelope(
  value: unknown,
): value is
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } } {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  const v = value as { ok: unknown; data?: unknown; error?: unknown };
  if (v.ok === true) return "data" in v;
  if (v.ok === false) {
    return (
      typeof v.error === "object" &&
      v.error !== null &&
      "code" in v.error &&
      "message" in v.error
    );
  }
  return false;
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Register when API returns site-password UNAUTHORIZED (e.g. show lock screen). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function notifyUnauthorized() {
  for (const fn of unauthorizedListeners) {
    try {
      fn();
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Parse `{ ok, data } | { ok, error }` and return `data` (or throw). */
export async function unwrap<R extends { json(): Promise<unknown>; status: number }>(
  resPromise: Promise<R>,
): Promise<OkData<JsonBodyOf<R>>> {
  const res = await resPromise;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("INVALID_JSON", "Invalid JSON response", res.status);
  }
  if (!isEnvelope(body)) {
    throw new ApiError("BAD_SHAPE", "Unexpected response shape", res.status);
  }
  if (!body.ok) {
    const code = body.error.code || "REQUEST_FAILED";
    const message = body.error.message || code;
    if (code === "UNAUTHORIZED" || res.status === 401) {
      if (code === "UNAUTHORIZED") {
        setAppToken(null);
        notifyUnauthorized();
      }
    }
    throw new ApiError(code, message, res.status);
  }
  return body.data as OkData<JsonBodyOf<R>>;
}

/** Image proxy URL (binary — not via hc). */
export function proxyUrl(cover: string, sourceKey?: string) {
  if (!cover) return "";
  if (cover.startsWith("/api/")) return cover;
  if (cover.startsWith("data:")) return cover;
  return `/api/proxy/image?u=${encodeURIComponent(cover)}${sourceKey ? `&s=${sourceKey}` : ""}`;
}
