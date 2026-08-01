import type {
  AccountStatus,
  CategoryNode,
  ComicBrief,
  ComicInfo,
  ExploreMixed,
  ExplorePageMeta,
  PageResult,
  SearchOption,
  SourceCapabilities,
} from "../domain/models.ts";

export type ImageContext = {
  sourceKey: string;
  comicId?: string;
  ep?: string;
  imageKey?: string;
};

export type ImageRequest = {
  url: string;
  headers: Record<string, string>;
};

export type LoginPayload = {
  username?: string;
  password?: string;
  cookie?: string;
  cookies?: Record<string, string>;
  extra?: Record<string, string | boolean | number>;
};

export interface ComicSourceAdapter {
  key: string;
  name: string;
  capabilities: SourceCapabilities;
  imageHosts: string[];
  /** Search sort options; first entry is the default. Empty = no sort UI. */
  searchOptions?: SearchOption[];
  /** Ranking period/order options; first entry is the default. */
  rankingOptions?: SearchOption[];

  getExplorePages(): ExplorePageMeta[];
  loadExplore(pageKey: string, page: number): Promise<ExploreMixed>;
  search(keyword: string, page: number, options?: string[]): Promise<PageResult<ComicBrief>>;
  getCategories?(): Promise<CategoryNode[]>;
  loadCategory?(
    category: string,
    param: string | null,
    options: string[],
    page: number,
  ): Promise<PageResult<ComicBrief>>;
  loadRanking?(option: string, page: number): Promise<PageResult<ComicBrief>>;
  loadComicInfo(id: string): Promise<ComicInfo>;
  loadComicPages(id: string, ep?: string | null): Promise<string[]>;

  getAccountStatus?(): AccountStatus;
  login?(payload: LoginPayload): Promise<void>;
  reLogin?(): Promise<void>;
  logout?(): Promise<void>;
  isLoggedIn?(): boolean;
  /** Optional: refresh profile fields before returning account status */
  refreshAccountInfo?(): Promise<void>;
  setAccountOption?(key: string, value: string | boolean): Promise<void> | void;
  /**
   * Source-specific account actions (e.g. jm `syncDomains`).
   * May return a message for the UI.
   */
  runAccountAction?(
    action: string,
  ): Promise<{ message?: string } | void> | { message?: string } | void;

  getNetworkFavorites?(page: number, folder?: string): Promise<PageResult<ComicBrief>>;
  toggleNetworkFavorite?(id: string, add: boolean): Promise<void>;
  getImageRequest(url: string, ctx: ImageContext): ImageRequest;
  transformImage?(buffer: Buffer, ctx: ImageContext): Promise<Buffer>;
}

export class SourceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SourceError";
  }
}
