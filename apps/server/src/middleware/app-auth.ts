import type { MiddlewareHandler } from "hono";

import { config } from "../config.ts";
import {
  expectedAppToken,
  PUBLIC_API_PATHS,
  readAppToken,
  tokensEqual,
} from "../lib/app-auth.ts";

/** Optional site password (`APP_PASSWORD`) for `/api/*`. */
export const appAuth: MiddlewareHandler = async (c, next) => {
  if (!config.appPassword) return next();
  if (PUBLIC_API_PATHS.has(c.req.path)) return next();

  const token = readAppToken(c);
  if (!token || !tokensEqual(token, expectedAppToken())) {
    return c.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "需要访问口令" },
      },
      401,
    );
  }
  return next();
};
