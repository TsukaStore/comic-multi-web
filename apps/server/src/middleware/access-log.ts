import type { MiddlewareHandler } from "hono";

import { log } from "../lib/log.ts";

/** Access log at info+ only (default log level warn → quiet). */
export const accessLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  log.info(
    `${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`,
  );
};
