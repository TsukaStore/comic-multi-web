/**
 * Hono + Zod: thin wrapper around @hono/zod-validator
 * so validation errors match our { ok: false, error } envelope.
 */
import { zValidator as zv } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

import { err } from "../domain/result.ts";

export function zValidator<
  T extends ZodType,
  Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
  return zv(target, schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
      const message = issue?.message
        ? `${path}${issue.message}`
        : "请求参数不合法";
      return c.json(err("VALIDATION", message), 400);
    }
  });
}
