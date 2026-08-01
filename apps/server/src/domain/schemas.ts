/**
 * Request schemas for Hono zValidator.
 * Only user-input / write paths — not upstream comic payloads.
 */
import { z } from "zod";

export const LoginBodySchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  cookie: z.string().optional(),
  cookies: z.record(z.string(), z.string()).optional(),
  fields: z.record(z.string(), z.string()).optional(),
  extra: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const AccountOptionBodySchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.boolean()]),
});

export const AccountActionBodySchema = z.object({
  action: z.string().min(1),
});

export const AddFavoriteBodySchema = z.object({
  folderId: z.string().optional(),
  sourceKey: z.string().min(1),
  comicId: z.string().min(1),
  title: z.string().min(1),
  cover: z.string(),
  tags: z.array(z.string()).optional(),
});

export const CreateFolderBodySchema = z.object({
  name: z.string().min(1),
});

export const PutHistoryBodySchema = z.object({
  sourceKey: z.string().min(1),
  comicId: z.string().min(1),
  title: z.string().min(1),
  cover: z.string(),
  ep: z.string().optional(),
  page: z.number().int().min(0).optional(),
});

export const EnqueueDownloadBodySchema = z.object({
  sourceKey: z.string().min(1),
  comicId: z.string().min(1),
  title: z.string().min(1),
  cover: z.string().optional(),
  ep: z.string().optional(),
});

export const AppSettingsBodySchema = z.object({
  enabledSources: z.array(z.string()),
  readerMode: z.enum(["scroll", "ltr", "rtl"]),
  preloadCount: z.number().int().min(0).max(20),
  logLevel: z.enum(["silent", "error", "warn", "info", "debug"]).optional(),
  httpProxy: z.string().optional(),
  webdav: z
    .object({
      url: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
});

export const AppAuthBodySchema = z.object({
  password: z.string().optional(),
});

export const ToggleFavoriteBodySchema = z
  .object({
    add: z.boolean().optional(),
  })
  .default({});

export const DeleteDownloadQuerySchema = z.object({
  hard: z.enum(["0", "1"]).optional(),
});

/** Common list query — page as string so hc query matches URL params */
export const PageQuerySchema = z.object({
  page: z.string().optional(),
});

export const SearchQuerySchema = z.object({
  q: z.string().optional(),
  page: z.string().optional(),
  option: z.string().optional(),
});

export const CategoryQuerySchema = z.object({
  name: z.string().optional(),
  param: z.string().optional(),
  page: z.string().optional(),
  option: z.string().optional(),
});

export const RankingQuerySchema = z.object({
  option: z.string().optional(),
  page: z.string().optional(),
});

export const ComicPagesQuerySchema = z.object({
  ep: z.string().optional(),
});

export const LocalFavoritesQuerySchema = z.object({
  folderId: z.string().optional(),
});

export const RemoveFavoriteQuerySchema = z.object({
  sourceKey: z.string().min(1),
  comicId: z.string().min(1),
  folderId: z.string().optional(),
});

export const HistoryDeleteQuerySchema = z.object({
  sourceKey: z.string().optional(),
  comicId: z.string().optional(),
});

export const SearchHistoryDeleteQuerySchema = z.object({
  keyword: z.string().optional(),
});
