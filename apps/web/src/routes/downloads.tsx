import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { client, unwrap, type DownloadTask } from "@/api/client";
import { Empty, Spinner } from "@/components/feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/downloads")({
  component: DownloadsPage,
});

function DownloadsPage() {
  const [items, setItems] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function reload() {
    unwrap(client.downloads.$get())
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    const t = window.setInterval(reload, 2000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="min-w-0 space-y-5">
      <h1 className="text-lg font-semibold tracking-tight">下载</h1>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading && !items.length ? <Spinner /> : null}
      {!loading && !items.length ? (
        <Empty title="下载队列为空" desc="在详情页将章节加入下载" />
      ) : null}
      <div className="space-y-2">
        {items.map((d) => (
          <Card
            key={d.id}
            size="sm"
            className="flex-row flex-wrap items-center gap-3 px-3 py-3 ring-border/40"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 text-sm wrap-anywhere">
                  {d.title}
                </span>
                <Badge variant="secondary" className="font-normal">
                  {d.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {d.sourceKey}
                {d.total ? ` · ${d.progress}/${d.total}` : ""}
                {d.error ? ` · ${d.error}` : ""}
              </div>
              {d.total > 0 ? (
                <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary/70"
                    style={{ width: `${Math.round((d.progress / d.total) * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void unwrap(
                  client.downloads[":id"].$delete({
                    param: { id: d.id },
                    query: {
                      hard:
                        d.status === "done" || d.status === "error" ? "1" : "0",
                    },
                  }),
                ).then(reload)
              }
            >
              {d.status === "queued" || d.status === "running" ? "取消" : "删除"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
