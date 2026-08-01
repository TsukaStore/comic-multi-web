/** Domain models — shared by sources, services, and type-only export via server/rpc. */

export type SourceCapabilities = {
  search: boolean;
  category: boolean;
  ranking: boolean;
  account: boolean;
  networkFavorites: boolean;
  comments: boolean;
  multiChapter: boolean;
};

/** Per-source search sort / filter option (passed as API `option` → adapter options[0]). */
export type SearchOption = {
  value: string;
  label: string;
};

export type ComicBrief = {
  id: string;
  sourceKey: string;
  title: string;
  subTitle: string;
  cover: string;
  tags: string[];
  description: string;
  pageCount?: number;
};

export type ComicInfo = {
  sourceKey: string;
  comicId: string;
  title: string;
  subTitle?: string;
  cover: string;
  description?: string;
  tags: Record<string, string[]>;
  chapters?: Record<string, string>;
  pageCount?: number;
  isFavorite?: boolean;
  suggestions?: ComicBrief[];
};

export type PageResult<T> = {
  items: T[];
  maxPage?: number | null;
};

export type ExplorePageMeta = {
  key: string;
  title: string;
  type: "list" | "multipart" | "mixed";
};

export type ExplorePart = {
  title: string;
  comics: ComicBrief[];
  viewMore?: string | null;
};

export type ExploreMixed = {
  parts?: ExplorePart[];
  items?: ComicBrief[];
  maxPage?: number | null;
};

export type CategoryNode = {
  name: string;
  param?: string;
  children?: string[];
};

export type AccountField = {
  key: string;
  label: string;
  type: "text" | "password" | "textarea";
  required: boolean;
  placeholder?: string;
  hint?: string;
};

export type AccountInfoItem = {
  title: string;
  value?: string;
};

export type AccountAction = {
  key: string;
  label: string;
  hint?: string;
};

export type AccountStatus = {
  sourceKey: string;
  name: string;
  loggedIn: boolean;
  allowReLogin: boolean;
  registerUrl?: string;
  loginMode: "password" | "cookies" | "cookie_fields";
  /** short help shown inside the account card */
  description?: string;
  fields: AccountField[];
  infoItems: AccountInfoItem[];
  options?: {
    key: string;
    label: string;
    type: "select" | "switch";
    value: string | boolean;
    choices?: { value: string; label: string }[];
  }[];
  /** one-shot actions e.g. JM sync domains */
  actions?: AccountAction[];
};

export type FavoriteFolder = {
  id: string;
  name: string;
  orderIndex: number;
};

export type FavoriteItem = {
  id: string;
  folderId: string;
  sourceKey: string;
  comicId: string;
  title: string;
  cover: string;
  tags: string[];
  addedAt: number;
};

export type HistoryItem = {
  sourceKey: string;
  comicId: string;
  title: string;
  cover: string;
  ep: string;
  page: number;
  updatedAt: number;
};

export type DownloadStatus =
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "error"
  | "cancelled";

export type DownloadTask = {
  id: string;
  sourceKey: string;
  comicId: string;
  title: string;
  cover: string;
  ep: string;
  status: DownloadStatus;
  progress: number;
  total: number;
  path?: string;
  error?: string;
  createdAt: number;
};

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type AppSettings = {
  enabledSources: string[];
  readerMode: "scroll" | "ltr" | "rtl";
  preloadCount: number;
  /** Server log verbosity (request access logs need info+) */
  logLevel?: LogLevel;
  httpProxy?: string;
  webdav?: {
    url?: string;
    username?: string;
    password?: string;
  };
};

export const SOURCE_KEYS = ["nhentai", "picacg", "ehentai", "jm"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
