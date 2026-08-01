import { serve } from "@hono/node-server";

import { app } from "./app.ts";
import { config } from "./config.ts";
import { log } from "./lib/log.ts";

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info(`comic-multi-web server on http://localhost:${info.port}`);
  log.debug(`data dir: ${config.dataDir}`);
  log.debug(`sources: ${config.enabledSources.join(", ")}`);
});
