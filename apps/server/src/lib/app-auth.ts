import { createHash, timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { config } from "../config.ts";

/** Paths that skip APP_PASSWORD when set. */
export const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/status",
]);

export function appTokenHash(password: string): string {
  return createHash("sha256").update(`cmw:${password}`).digest("hex");
}

export function tokensEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function readAppToken(c: Context): string {
  return getCookie(c, "app_token") || c.req.header("x-app-token") || "";
}

/** Expected token for the current `APP_PASSWORD` (empty if unset). */
export function expectedAppToken(): string {
  return config.appPassword ? appTokenHash(config.appPassword) : "";
}

export function isAppAuthenticated(c: Context): boolean {
  if (!config.appPassword) return true;
  const token = readAppToken(c);
  return Boolean(token) && tokensEqual(token, expectedAppToken());
}
