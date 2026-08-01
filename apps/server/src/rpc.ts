/**
 * Type-only entry for the frontend.
 * `import type { AppType, ComicBrief, ... } from "server/rpc"`
 */
export type { AppType } from "./routes/api.ts";
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
  SourceCapabilities,
} from "./domain/models.ts";
