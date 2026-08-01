import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { client, proxyUrl, unwrap, type ComicInfo } from "@/api/client";
import { Spinner } from "@/components/feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/comic/$sourceKey/$id")({
  component: ComicDetailPage,
});

function ComicDetailPage() {
  const { sourceKey, id } = Route.useParams();
  const [info, setInfo] = useState<ComicInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fav, setFav] = useState(false);
  const [busy, setBusy] = useState(false);
  /** true = source-site cloud fav; false = local SQLite fav */
  const [useCloudFav, setUseCloudFav] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      unwrap(
        client.sources[":key"].comics[":id"].$get({
          param: { key: sourceKey, id },
        }),
      ),
      unwrap(client.sources.$get()).catch(() => []),
    ])
      .then(([data, sources]) => {
        setInfo(data);
        const src = sources.find((s) => s.key === sourceKey);
        const cloud =
          Boolean(src?.capabilities?.networkFavorites) && Boolean(src?.loggedIn);
        setUseCloudFav(cloud);
        if (cloud) {
          setFav(Boolean(data.isFavorite));
        } else {
          setFav(Boolean(data.isFavorite));
          void unwrap(client.local.favorites.$get({ query: {} }))
            .then((f) => {
              const hit = f.items.some(
                (x) => x.sourceKey === sourceKey && x.comicId === id,
              );
              if (hit) setFav(true);
            })
            .catch(() => undefined);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sourceKey, id]);

  if (loading) return <Spinner />;
  if (error && !info) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!info) return null;

  const chapters = Object.entries(info.chapters ?? { "1": "开始阅读" });

  async function toggleFav() {
    if (!info) return;
    setBusy(true);
    setError("");
    try {
      if (useCloudFav) {
        await unwrap(
          client.sources[":key"].favorites[":id"].$post({
            param: { key: sourceKey, id },
            json: { add: !fav },
          }),
        );
        setFav(!fav);
      } else if (fav) {
        await unwrap(
          client.local.favorites.$delete({
            query: { sourceKey, comicId: id, folderId: "default" },
          }),
        );
        setFav(false);
      } else {
        await unwrap(
          client.local.favorites.$post({
            json: {
              sourceKey,
              comicId: id,
              title: info.title,
              cover: info.cover,
              tags: Object.values(info.tags).flat(),
            },
          }),
        );
        setFav(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download(ep: string) {
    if (!info) return;
    setBusy(true);
    try {
      await unwrap(
        client.downloads.$post({
          json: {
            sourceKey,
            comicId: id,
            title: info.title,
            cover: info.cover,
            ep,
          },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6">
      <div className="flex min-w-0 flex-col gap-6 sm:flex-row">
        <div className="mx-auto w-full max-w-48 shrink-0 sm:mx-0 sm:w-48 sm:max-w-none">
          <div className="aspect-3/4 overflow-hidden rounded-lg border border-border bg-muted">
            <img
              src={proxyUrl(info.cover, sourceKey)}
              alt={info.title}
              className="h-full w-full object-cover"
            />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-4 overflow-hidden">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge variant="secondary">{sourceKey}</Badge>
              {info.pageCount ? (
                <Badge variant="outline">{info.pageCount} 页</Badge>
              ) : null}
            </div>
            <h1 className="text-xl font-semibold tracking-tight wrap-anywhere">
              {info.title}
            </h1>
            {info.subTitle ? (
              <p className="mt-1 text-base text-muted-foreground wrap-anywhere">
                {info.subTitle}
              </p>
            ) : null}
          </div>
          {info.description ? (
            <p className="max-w-full text-base leading-relaxed whitespace-pre-wrap text-muted-foreground wrap-anywhere">
              {info.description}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link
                to="/read/$sourceKey/$id"
                params={{ sourceKey, id }}
                search={{ ep: chapters[0]?.[0], page: 0 }}
              >
                阅读
              </Link>
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void toggleFav()}>
              {fav
                ? useCloudFav
                  ? "取消云端收藏"
                  : "取消收藏"
                : useCloudFav
                  ? "云端收藏"
                  : "收藏"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void download(chapters[0]?.[0] || "1")}
            >
              下载
            </Button>
          </div>

          <Separator />

          {Object.entries(info.tags).map(([group, tags]) =>
            tags.length ? (
              <div key={group} className="min-w-0">
                <div className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Button
                      key={t}
                      variant="outline"
                      size="xs"
                      asChild
                      className="h-auto max-w-full whitespace-normal text-left wrap-anywhere"
                    >
                      <Link to="/search" search={{ q: t, source: sourceKey, page: 1 }}>
                        {t}
                      </Link>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      </div>

      {chapters.length > 1 ? (
        <section className="min-w-0">
          <h2 className="mb-3 text-base font-medium">章节</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {chapters.map(([ep, name]) => (
              <Card
                key={ep}
                size="sm"
                className="min-w-0 flex-row items-center justify-between gap-2 px-3 py-2.5 ring-border/40"
              >
                <Link
                  to="/read/$sourceKey/$id"
                  params={{ sourceKey, id }}
                  search={{ ep, page: 0 }}
                  className="min-w-0 flex-1 truncate text-sm hover:text-primary"
                >
                  {name}
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0"
                  onClick={() => void download(ep)}
                >
                  下载
                </Button>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
