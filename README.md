# comic-multi-web

Self-hosted multi-source comic reader. Browse, search, read, favorite, and download from nhentai, picacg, E-Hentai, and jm in a dark web UI.

## Requirements

- Node.js **≥ 22.12**
- [pnpm](https://pnpm.io/) **11+** (see `packageManager` in `package.json`)

## Install & run (development)

```bash
pnpm install
pnpm dev
```

- Web UI: http://localhost:4781  
- API: http://localhost:3847  

Data is stored under `./data` by default.

## Production build

```bash
pnpm build
pnpm --filter server start
```

Or use Docker (recommended).

## Docker

```bash
docker compose up --build
```

Open http://localhost:8080  

Data persists in the `comic-data` volume.

### Image from GitHub Container Registry

Each release tag is published to GHCR. Prefer the **latest** image or the newest tag on the [Releases](../../releases) page:

```bash
# always the most recent release build
docker pull ghcr.io/tsukastore/comic-multi-web:latest

# or pin to a specific release (see Releases for the current tag)
# docker pull ghcr.io/tsukastore/comic-multi-web:vX.Y.Z
```

## Configuration

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (Compose uses `8080`) |
| `DATA_DIR` | Where SQLite and downloads are stored |
| `APP_PASSWORD` | Optional site password; leave empty for open access |
| `HTTP_PROXY` / `HTTPS_PROXY` | Outbound proxy for fetching sources |
| `ENABLED_SOURCES` | Comma-separated sources to enable at start |

Most day-to-day options (enabled sources, reader mode, proxy, log level, WebDAV) can also be changed in the app under **Settings**.

## Accounts

Use the **Accounts** page in the app to log into each source (cookie or username/password, depending on the site).

## Disclaimer

For personal self-hosting and learning only. Comply with local law and each source’s terms of service.
