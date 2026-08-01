# comic-multi-web

Self-hosted multi-source comic reader (TypeScript full stack).  
Frontend: dark monochrome Web UI (Vercel-like). **Do not** port PicaComic UI.

## Language

- **English** for all repository documentation, commit messages, PR text, and contributor-facing comments.
- Product UI strings may stay localized (Chinese labels in the app are fine).

## Toolchain

| Item | Notes |
|------|--------|
| **pnpm** workspaces | `apps/web`, `apps/server` (`packages/*` reserved) |
| **catalog** | Shared versions in `pnpm-workspace.yaml` — prefer `catalog:` in package.json |
| **Policy** | Use **latest major** for dependencies; no legacy API shims after upgrades |
| **Vite+** (`vp`) | install / dev / build / check / lint / fmt |
| **TypeScript** | 7.x — no `baseUrl`; put full paths in `compilerOptions.paths` |
| **Node** | `>= 22.12` |

## Commands

```bash
vp install              # or pnpm install
pnpm dev                # web :4781 + server :3847 (proxy /api → 3847)
pnpm build
pnpm --filter web check
pnpm --filter server check
pnpm --filter server test
docker compose up --build
```

## Layout

```
apps/web/src
  api/client.ts         # hc<AppType> + unwrap + proxyUrl only (no api facade)
  routes/               # TanStack file routes
  components/           # Shell, ComicCard, UI (shadcn)
apps/server/src
  routes/api.ts         # Hono chain → export type AppType
  rpc.ts                # type-only export: AppType + domain models
  sources/*             # adapters only (upstream protocol)
  services/*            # local favorites, history, search-history, downloads, webdav
  http/client.ts        # ky v2 (prefix, not prefixUrl) + undici proxy
  domain/               # models, schemas, result envelope
  lib/log.ts            # log levels (default warn)
data/                   # SQLite + downloads (local)
```

## Frontend API (Hono RPC)

- Import: `import type { AppType } from "server/rpc"` (path / package export)
- Client: `export const client = hc<AppType>("/api")`
- Pages call **`unwrap(client.....$get/post(...))` directly** — do **not** reintroduce a 1:1 `api` facade
- Keep thin helpers only: `unwrap` (envelope), `proxyUrl` (binary images)
- Types: re-export domain types from `server/rpc` (e.g. `ComicBrief`, `AccountStatus`) — single source of truth
- Server routes that take query/json must use **`zValidator`** so `hc` gets typed args

## Backend conventions

- **Sources only** in `apps/server/src/sources/*` for upstream APIs (align protocols with PicaComic where applicable)
- Pagination: pass **page + sort option** only; **page size is upstream-defined** (no client pageSize)
- Search: `GET /sources/:key/search?q&page&option` — first page with non-empty `q` writes **search history**
- List search options via `source.searchOptions` on `GET /sources`
- Envelope: `{ ok: true, data } | { ok: false, error: { code, message } }` (`ok` / `err`)
- Images: **always** `/api/proxy/image` + host allowlist; JM scramble in `transformImage`

## Product / UX notes

- **Browse (`/`)**: source pills; modes **Explore / Category / Ranking** driven by `capabilities` + `explorePages` + `rankingOptions` from `GET /sources` (no hard-coded single pageKey)
- **Accounts** page: per-source login, profile, options, actions (e.g. JM domain sync)
- **Search**: sort select from `searchOptions`; history chips when `q` empty
- **Reader**: modes `scroll | ltr | rtl`; in-reader **chapter/ep** select when `chapters` length > 1; swipe / edge tap / keys; preload; mode persists to settings
- **Settings**: `enabledSources` (filters `listSources`), `readerMode`, `preloadCount`, `logLevel`, `httpProxy`, WebDAV
- **Logging**: `apps/server/src/lib/log.ts` — default **`warn`** (no per-request access lines); set `logLevel` to `info`/`debug` in Settings for verbose; `silent` mutes all
- **Library**: local favorites, cloud favorites (logged-in sources), reading history
- Tailwind v4: prefer canonical utilities (`max-w-48`, `aspect-3/4`, `wrap-anywhere`, …)
- Mobile: `min-w-0` / `overflow-x-hidden` / `wrap-anywhere` on long text
- **Shell**: `h-dvh`; sidebar fixed; only `main` scrolls
- **Tests**: `pnpm --filter server test` (capability matrix + content RPC + web surface structure)

## Dependency upgrade rules

1. Prefer **latest major** of each direct dependency (catalog first)
2. After major bumps, **update call sites** to current APIs — no long-lived compatibility aliases
3. Example: ky v2 uses `prefix`, not `prefixUrl`
4. Run web + server `check` and build after upgrades

## Out of scope / non-goals

- Native app shell / WebView-only CF bypass (pure web uses server-side APIs)
- Copying PicaComic branding or layout
- Duplicate DTO definitions on the web that drift from server models
- Comments UI; offline open of completed downloads
