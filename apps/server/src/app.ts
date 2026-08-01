import { Hono } from "hono";
import { cors } from "hono/cors";

import { getDb, getSetting } from "./db/index.ts";
import type { AppSettings } from "./domain/models.ts";
import { setLogLevel } from "./lib/log.ts";
import { accessLog } from "./middleware/access-log.ts";
import { appAuth } from "./middleware/app-auth.ts";
import { api } from "./routes/api.ts";
import { spa } from "./routes/spa.ts";

getDb();

{
  const s = getSetting<AppSettings>("app", {
    enabledSources: [],
    readerMode: "scroll",
    preloadCount: 3,
    logLevel: "warn",
  });
  setLogLevel(s.logLevel ?? "warn");
}

export const app = new Hono();

app.use("*", accessLog);
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.use("/api/*", appAuth);
app.route("/api", api);
app.get("*", spa);
