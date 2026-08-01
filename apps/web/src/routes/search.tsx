import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search as SearchIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { client, unwrap, type ComicBrief, type SearchOption } from "@/api/client";
import { ComicGrid } from "@/components/ComicCard";
import { Empty, Spinner } from "@/components/feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SearchParams = {
  q?: string;
  source?: string;
  page?: number;
  option?: string;
};

type SourceRow = {
  key: string;
  name: string;
  searchOptions: SearchOption[];
};

type HistoryRow = {
  keyword: string;
  updatedAt: number;
};

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    q: typeof s.q === "string" ? s.q : "",
    source: typeof s.source === "string" ? s.source : "",
    page: Number(s.page) > 0 ? Number(s.page) : 1,
    option: typeof s.option === "string" ? s.option : "",
  }),
  component: SearchPage,
});

function SearchPage() {
  const {
    q = "",
    source = "",
    page = 1,
    option = "",
  } = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const [input, setInput] = useState(q);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [items, setItems] = useState<ComicBrief[]>([]);
  const [maxPage, setMaxPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const activeSource = useMemo(
    () => sources.find((s) => s.key === source),
    [sources, source],
  );
  const sortOptions = activeSource?.searchOptions ?? [];
  const effectiveOption =
    option && sortOptions.some((o) => o.value === option)
      ? option
      : sortOptions[0]?.value || "";

  const reloadHistory = useCallback(() => {
    void unwrap(client.local["search-history"].$get())
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    void unwrap(client.sources.$get()).then((list) => {
      const rows: SourceRow[] = list.map((s) => ({
        key: s.key,
        name: s.name,
        searchOptions: s.searchOptions ?? [],
      }));
      setSources(rows);
      if (!source && rows[0]) {
        const first = rows[0];
        void navigate({
          search: (prev) => ({
            ...prev,
            source: first.key,
            option: first.searchOptions[0]?.value || "",
          }),
          replace: true,
        });
      }
    });
    reloadHistory();
  }, []);

  // Keep URL option valid when source / options load
  useEffect(() => {
    if (!source || !sortOptions.length) return;
    if (!option || !sortOptions.some((o) => o.value === option)) {
      void navigate({
        search: (prev) => ({
          ...prev,
          option: sortOptions[0]!.value,
        }),
        replace: true,
      });
    }
  }, [source, sortOptions, option, navigate]);

  useEffect(() => {
    setInput(q);
  }, [q]);

  useEffect(() => {
    if (!q || !source) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    unwrap(
      client.sources[":key"].search.$get({
        param: { key: source },
        query: {
          q,
          page: String(page),
          ...(effectiveOption ? { option: effectiveOption } : {}),
        },
      }),
    )
      .then((data) => {
        setItems(data.items);
        setMaxPage(data.maxPage ?? null);
        // server records on page 1; refresh chips
        if (page <= 1) reloadHistory();
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, source, page, effectiveOption, reloadHistory]);

  function goSearch(keyword: string) {
    const key = source || sources[0]?.key || "";
    const opts = sources.find((s) => s.key === key)?.searchOptions ?? [];
    void navigate({
      search: {
        q: keyword.trim(),
        source: key,
        page: 1,
        option: option || opts[0]?.value || "",
      },
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    goSearch(input);
  }

  async function removeKeyword(keyword: string) {
    await unwrap(
      client.local["search-history"].$delete({
        query: { keyword },
      }),
    );
    reloadHistory();
  }

  async function clearAll() {
    await unwrap(
      client.local["search-history"].$delete({
        query: {},
      }),
    );
    reloadHistory();
  }

  const showHistory = !q && history.length > 0;

  return (
    <div className="min-w-0 space-y-5">
      <h1 className="text-lg font-semibold tracking-tight">搜索</h1>
      <form
        onSubmit={submit}
        className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap"
      >
        <div className="relative min-w-0 sm:flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="关键词 / 标签"
            autoFocus
            className="pl-9"
          />
        </div>
        <Select
          value={source || undefined}
          onValueChange={(value) => {
            const opts =
              sources.find((s) => s.key === value)?.searchOptions ?? [];
            void navigate({
              search: (prev) => ({
                ...prev,
                source: value,
                page: 1,
                option: opts[0]?.value || "",
              }),
            });
          }}
        >
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="选择源" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sortOptions.length ? (
          <Select
            value={effectiveOption || undefined}
            onValueChange={(value) =>
              void navigate({
                search: (prev) => ({ ...prev, option: value, page: 1 }),
              })
            }
          >
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button type="submit">
          <SearchIcon />
          搜索
        </Button>
      </form>

      {showHistory ? (
        <section className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">搜索记录</h2>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void clearAll()}
            >
              清空
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            {history.map((h) => (
              <div
                key={h.keyword}
                className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-card pl-1"
              >
                <button
                  type="button"
                  className="min-w-0 truncate px-2.5 py-1.5 text-left text-sm hover:text-primary"
                  onClick={() => goSearch(h.keyword)}
                >
                  {h.keyword}
                </button>
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`删除 ${h.keyword}`}
                  onClick={() => void removeKeyword(h.keyword)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!q && !history.length ? (
        <Empty title="输入关键词搜索" desc="最近搜索会出现在这里" />
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? <Spinner /> : null}
      {!loading && q && !items.length && !error ? (
        <Empty title="无结果" desc={`「${q}」在 ${source} 中没有匹配`} />
      ) : null}
      <ComicGrid comics={items} />

      {items.length ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() =>
              void navigate({
                search: (p) => ({ ...p, page: Math.max(1, (p.page ?? 1) - 1) }),
              })
            }
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            {page}
            {maxPage ? ` / ${maxPage}` : ""}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={maxPage != null && page >= maxPage}
            onClick={() =>
              void navigate({ search: (p) => ({ ...p, page: (p.page ?? 1) + 1 }) })
            }
          >
            下一页
          </Button>
        </div>
      ) : null}
    </div>
  );
}
