import type { AppSettings } from "../domain/models.ts";
import { getSetting } from "../db/index.ts";
import { config } from "../config.ts";
import { ehentai } from "./ehentai/index.ts";
import { jm } from "./jm/index.ts";
import { nhentai } from "./nhentai/index.ts";
import { picacg } from "./picacg/index.ts";
import type { ComicSourceAdapter } from "./adapter.ts";
import { SourceError } from "./adapter.ts";

/** All built-in adapters (ignore enable flags). */
export const ALL_SOURCES: ComicSourceAdapter[] = [nhentai, picacg, ehentai, jm];

const DEFAULT_SETTINGS: AppSettings = {
  enabledSources: ["nhentai", "picacg", "ehentai", "jm"],
  readerMode: "scroll",
  preloadCount: 3,
  logLevel: "warn",
};

/** Effective enable list: app settings if set, else env ENABLED_SOURCES. */
export function resolveEnabledSourceKeys(): string[] {
  const fromEnv = config.enabledSources;
  const settings = getSetting<AppSettings>("app", {
    ...DEFAULT_SETTINGS,
    enabledSources: fromEnv.length ? fromEnv : DEFAULT_SETTINGS.enabledSources,
  });
  const keys =
    settings.enabledSources?.length > 0
      ? settings.enabledSources
      : fromEnv.length
        ? fromEnv
        : DEFAULT_SETTINGS.enabledSources;
  return keys.filter((k) => ALL_SOURCES.some((s) => s.key === k));
}

export function listSources(): ComicSourceAdapter[] {
  const enabled = new Set(resolveEnabledSourceKeys());
  return ALL_SOURCES.filter((s) => enabled.has(s.key));
}

export function getSource(key: string): ComicSourceAdapter {
  const source = listSources().find((s) => s.key === key);
  if (!source) {
    throw new SourceError(
      "SOURCE_NOT_FOUND",
      `Source not found or disabled: ${key}`,
    );
  }
  return source;
}

export function getAllImageHosts(): string[] {
  return [...new Set(ALL_SOURCES.flatMap((s) => s.imageHosts))];
}

/** Capability matrix rows for verification / diagnostics. */
export function buildCapabilityMatrix(): {
  key: string;
  name: string;
  capabilities: ComicSourceAdapter["capabilities"];
  explorePages: { key: string; title: string }[];
  searchOptions: { value: string; label: string }[];
  rankingOptions: { value: string; label: string }[];
  methods: {
    loadCategory: boolean;
    loadRanking: boolean;
    getCategories: boolean;
    getNetworkFavorites: boolean;
  };
}[] {
  return ALL_SOURCES.map((s) => ({
    key: s.key,
    name: s.name,
    capabilities: s.capabilities,
    explorePages: s.getExplorePages().map((p) => ({ key: p.key, title: p.title })),
    searchOptions: s.searchOptions ?? [],
    rankingOptions: s.rankingOptions ?? [],
    methods: {
      loadCategory: Boolean(s.loadCategory),
      loadRanking: Boolean(s.loadRanking),
      getCategories: Boolean(s.getCategories),
      getNetworkFavorites: Boolean(s.getNetworkFavorites),
    },
  }));
}
