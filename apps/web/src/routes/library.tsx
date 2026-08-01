import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import {
  client,
  proxyUrl,
  unwrap,
  type ComicBrief,
  type FavoriteItem,
  type HistoryItem,
} from "@/api/client";
import { ComicGrid } from "@/components/ComicCard";
import { Empty, Spinner } from "@/components/feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

type SourceMeta = {
  key: string;
  name: string;
  loggedIn: boolean;
  networkFavorites: boolean;
};

function LibraryPage() {
  const [tab, setTab] = useState<"local" | "cloud" | "history">("local");
  const [favs, setFavs] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [cloudKey, setCloudKey] = useState("");
  const [cloudItems, setCloudItems] = useState<ComicBrief[]>([]);
  const [cloudPage, setCloudPage] = useState(1);
  const [cloudMax, setCloudMax] = useState<number | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState("");

  const reloadLocal = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      unwrap(client.local.favorites.$get({ query: {} })),
      unwrap(client.local.history.$get()),
    ])
      .then(([f, h]) => {
        setFavs(f.items);
        setHistory(h);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reloadLocal();
    unwrap(client.sources.$get())
      .then((list) => {
        const cloud = list
          .filter((s) => s.capabilities?.networkFavorites && s.loggedIn)
          .map((s) => ({
            key: s.key,
            name: s.name,
            loggedIn: s.loggedIn,
            networkFavorites: Boolean(s.capabilities?.networkFavorites),
          }));
        setSources(cloud);
        if (cloud[0] && !cloudKey) setCloudKey(cloud[0].key);
      })
      .catch(() => {
        /* sources optional for local tab */
      });
  }, [reloadLocal]);

  const loadCloud = useCallback((key: string, page: number) => {
    if (!key) return;
    setCloudLoading(true);
    setCloudError("");
    unwrap(
      client.sources[":key"].favorites.$get({
        param: { key },
        query: { page: String(page) },
      }),
    )
      .then((data) => {
        setCloudItems(data.items || []);
        setCloudMax(data.maxPage ?? null);
        setCloudPage(page);
      })
      .catch((e) => {
        setCloudItems([]);
        setCloudError(e.message);
      })
      .finally(() => setCloudLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "cloud" && cloudKey) {
      loadCloud(cloudKey, 1);
    }
  }, [tab, cloudKey, loadCloud]);

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">书库</h1>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "local" | "cloud" | "history")}
      >
        <TabsList>
          <TabsTrigger value="local">本地收藏</TabsTrigger>
          <TabsTrigger value="cloud">云端收藏</TabsTrigger>
          <TabsTrigger value="history">历史</TabsTrigger>
        </TabsList>

        <TabsContent value="local" className="mt-4">
          {loading ? (
            <Spinner />
          ) : favs.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {favs.map((f) => (
                <Link
                  key={f.id}
                  to="/comic/$sourceKey/$id"
                  params={{ sourceKey: f.sourceKey, id: f.comicId }}
                  className="group space-y-2"
                >
                  <div className="aspect-3/4 overflow-hidden rounded-md border border-border bg-muted">
                    <img
                      src={proxyUrl(f.cover, f.sourceKey)}
                      alt={f.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="line-clamp-2 text-sm wrap-anywhere">
                    {f.title}
                  </div>
                  <div className="text-xs text-muted-foreground">{f.sourceKey}</div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="还没有本地收藏" desc="在详情页点击收藏（未登录源站时写入本地）" />
          )}
        </TabsContent>

        <TabsContent value="cloud" className="mt-4 space-y-4">
          {!sources.length ? (
            <Empty
              title="没有已登录的云端收藏源"
              desc="请先在「账号」页登录支持云端收藏的源（如 nhentai / picacg / 禁漫）"
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {sources.map((s) => (
                  <Button
                    key={s.key}
                    type="button"
                    size="sm"
                    variant={cloudKey === s.key ? "default" : "outline"}
                    className={cn("rounded-full")}
                    onClick={() => setCloudKey(s.key)}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>

              {cloudError ? (
                <Alert variant="destructive">
                  <AlertDescription>{cloudError}</AlertDescription>
                </Alert>
              ) : null}

              {cloudLoading ? (
                <Spinner label="加载云端收藏…" />
              ) : cloudItems.length ? (
                <>
                  <ComicGrid comics={cloudItems} />
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={cloudPage <= 1}
                      onClick={() => loadCloud(cloudKey, cloudPage - 1)}
                    >
                      上一页
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {cloudPage}
                      {cloudMax ? ` / ${cloudMax}` : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={cloudMax != null && cloudPage >= cloudMax}
                      onClick={() => loadCloud(cloudKey, cloudPage + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </>
              ) : !cloudError ? (
                <Empty title="该源暂无云端收藏" />
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {loading ? (
            <Spinner />
          ) : history.length ? (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {history.map((h) => (
                <div
                  key={`${h.sourceKey}:${h.comicId}`}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  <img
                    src={proxyUrl(h.cover, h.sourceKey)}
                    alt=""
                    className="h-14 w-10 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base">{h.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {h.sourceKey} · ep {h.ep || "-"} · p{h.page + 1}
                    </div>
                  </div>
                  <Button variant="outline" size="xs" asChild>
                    <Link
                      to="/read/$sourceKey/$id"
                      params={{ sourceKey: h.sourceKey, id: h.comicId }}
                      search={{ ep: h.ep || "1", page: h.page }}
                    >
                      续读
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void unwrap(
                        client.local.history.$delete({
                          query: {
                            sourceKey: h.sourceKey,
                            comicId: h.comicId,
                          },
                        }),
                      ).then(reloadLocal)
                    }
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="暂无阅读历史" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
