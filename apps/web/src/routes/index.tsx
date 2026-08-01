import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { client, unwrap, type ComicBrief, type SearchOption } from "@/api/client";
import { ComicGrid, ComicGridSkeleton } from "@/components/ComicCard";
import { Empty, SectionTitle } from "@/components/feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: ExplorePage,
});

type BrowseMode = "explore" | "category" | "ranking";

type SourceRow = {
  key: string;
  name: string;
  capabilities: {
    category: boolean;
    ranking: boolean;
    search: boolean;
  };
  explorePages: { key: string; title: string; type: string }[];
  rankingOptions: SearchOption[];
};

function ExplorePage() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [active, setActive] = useState("");
  const [mode, setMode] = useState<BrowseMode>("explore");
  const [pageKey, setPageKey] = useState("home");
  const [categoryName, setCategoryName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [rankOption, setRankOption] = useState("");
  const [parts, setParts] = useState<{ title: string; comics: ComicBrief[] }[]>(
    [],
  );
  const [items, setItems] = useState<ComicBrief[]>([]);
  const [page, setPage] = useState(1);
  const [maxPage, setMaxPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeSource = useMemo(
    () => sources.find((s) => s.key === active),
    [sources, active],
  );

  const explorePages = activeSource?.explorePages ?? [];
  const rankingOptions = activeSource?.rankingOptions ?? [];

  useEffect(() => {
    unwrap(client.sources.$get())
      .then((list) => {
        const rows: SourceRow[] = list.map((s) => ({
          key: s.key,
          name: s.name,
          capabilities: {
            category: Boolean(s.capabilities?.category),
            ranking: Boolean(s.capabilities?.ranking),
            search: Boolean(s.capabilities?.search),
          },
          explorePages: (s.explorePages ?? []).map((p) => ({
            key: p.key,
            title: p.title,
            type: p.type,
          })),
          rankingOptions: s.rankingOptions ?? [],
        }));
        setSources(rows);
        if (rows[0]) {
          setActive(rows[0].key);
          setPageKey(rows[0].explorePages[0]?.key || "home");
          setRankOption(rows[0].rankingOptions[0]?.value || "");
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  // Reset secondary selectors when source changes
  useEffect(() => {
    if (!activeSource) return;
    setMode("explore");
    setPage(1);
    setPageKey(activeSource.explorePages[0]?.key || "home");
    setRankOption(activeSource.rankingOptions[0]?.value || "");
    setCategoryName("");
    setCategories([]);
  }, [active]);

  // Load categories when entering category mode
  useEffect(() => {
    if (mode !== "category" || !active || !activeSource?.capabilities.category) {
      return;
    }
    void unwrap(
      client.sources[":key"].categories.$get({ param: { key: active } }),
    )
      .then((nodes) => {
        const names: string[] = [];
        for (const n of nodes) {
          if (n.children?.length) names.push(...n.children);
          else if (n.name) names.push(n.name);
        }
        setCategories(names);
        if (names[0] && !names.includes(categoryName)) {
          setCategoryName(names[0]);
        }
      })
      .catch((e) => setError(e.message));
  }, [mode, active, activeSource?.capabilities.category]);

  // Load list for current mode
  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setError("");
    setParts([]);
    setItems([]);

    const run = async () => {
      if (mode === "explore") {
        const key = pageKey || explorePages[0]?.key || "home";
        const data = await unwrap(
          client.sources[":key"].explore[":pageKey"].$get({
            param: { key: active, pageKey: key },
            query: { page: String(page) },
          }),
        );
        setParts(data.parts ?? []);
        setItems(data.items ?? []);
        setMaxPage(data.maxPage ?? null);
        return;
      }
      if (mode === "category") {
        if (!categoryName) {
          setItems([]);
          setMaxPage(null);
          return;
        }
        const data = await unwrap(
          client.sources[":key"].category.$get({
            param: { key: active },
            query: { name: categoryName, page: String(page) },
          }),
        );
        setItems(data.items ?? []);
        setMaxPage(data.maxPage ?? null);
        return;
      }
      if (mode === "ranking") {
        const option = rankOption || rankingOptions[0]?.value || "H24";
        const data = await unwrap(
          client.sources[":key"].ranking.$get({
            param: { key: active },
            query: { option, page: String(page) },
          }),
        );
        setItems(data.items ?? []);
        setMaxPage(data.maxPage ?? null);
      }
    };

    run()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [
    active,
    mode,
    page,
    pageKey,
    categoryName,
    rankOption,
    explorePages,
    rankingOptions,
  ]);

  const modes: { id: BrowseMode; label: string; show: boolean }[] = [
    { id: "explore", label: "探索", show: true },
    {
      id: "category",
      label: "分类",
      show: Boolean(activeSource?.capabilities.category),
    },
    {
      id: "ranking",
      label: "排行",
      show: Boolean(activeSource?.capabilities.ranking),
    },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold tracking-tight">浏览</h1>
        {sources.map((s) => (
          <Button
            key={s.key}
            type="button"
            size="sm"
            variant={active === s.key ? "default" : "outline"}
            className={cn("rounded-full")}
            onClick={() => setActive(s.key)}
          >
            {s.name}
          </Button>
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {modes
          .filter((m) => m.show)
          .map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant={mode === m.id ? "default" : "outline"}
              onClick={() => {
                setMode(m.id);
                setPage(1);
              }}
            >
              {m.label}
            </Button>
          ))}

        {mode === "explore" && explorePages.length > 1 ? (
          <div className="flex flex-wrap gap-1.5 sm:ml-2">
            {explorePages.map((p) => (
              <Button
                key={p.key}
                type="button"
                size="xs"
                variant={pageKey === p.key ? "secondary" : "ghost"}
                onClick={() => {
                  setPageKey(p.key);
                  setPage(1);
                }}
              >
                {p.title}
              </Button>
            ))}
          </div>
        ) : null}

        {mode === "category" && categories.length ? (
          <Select
            value={categoryName || undefined}
            onValueChange={(v) => {
              setCategoryName(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="选择分类" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {mode === "ranking" && rankingOptions.length ? (
          <Select
            value={rankOption || rankingOptions[0]?.value}
            onValueChange={(v) => {
              setRankOption(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="榜单" />
            </SelectTrigger>
            <SelectContent>
              {rankingOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? <ComicGridSkeleton /> : null}

      {!loading && !error ? (
        <>
          {parts.map((p) => (
            <section key={p.title}>
              <SectionTitle>{p.title}</SectionTitle>
              <ComicGrid comics={p.comics} />
            </section>
          ))}

          {items.length ? (
            <section>
              {parts.length ? <SectionTitle>更多</SectionTitle> : null}
              <ComicGrid comics={items} />
            </section>
          ) : null}

          {!parts.length && !items.length ? (
            <Empty title="暂无内容" desc="检查网络、源站或切换分类/榜单" />
          ) : null}

          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">
              {page}
              {maxPage ? ` / ${maxPage}` : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={maxPage != null && page >= maxPage}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
