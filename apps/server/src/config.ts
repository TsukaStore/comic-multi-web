import path from "node:path";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(env("PORT", "3847")),
  dataDir: path.resolve(env("DATA_DIR", "./data")),
  appPassword: env("APP_PASSWORD"),
  httpProxy: env("HTTP_PROXY") || env("HTTPS_PROXY") || undefined,
  enabledSources: env("ENABLED_SOURCES", "nhentai,picacg,ehentai,jm")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Relative to this package (src/ or dist/), not monorepo root
  webDist: path.resolve(
    env("WEB_DIST", path.join(import.meta.dirname, "../../web/dist")),
  ),
};
