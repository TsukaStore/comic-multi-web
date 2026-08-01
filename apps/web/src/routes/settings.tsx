import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { client, unwrap, type AppSettings, type LogLevel } from "@/api/client";
import { Spinner } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

type CatalogSource = { key: string; name: string };

function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [catalog, setCatalog] = useState<CatalogSource[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void Promise.all([
      unwrap(client.settings.$get()),
      unwrap(client.sources.catalog.$get()),
    ])
      .then(([s, cat]) => {
        setSettings(s);
        setCatalog(cat);
      })
      .catch((e) => setMsg(e.message));
  }, []);

  if (!settings) return <Spinner />;

  async function save(next: AppSettings) {
    setSettings(next);
    await unwrap(client.settings.$put({ json: next }));
    setMsg("已保存");
  }

  function toggleSource(key: string) {
    const cur = new Set(settings!.enabledSources);
    if (cur.has(key)) {
      if (cur.size <= 1) {
        setMsg("至少保留一个源");
        return;
      }
      cur.delete(key);
    } else {
      cur.add(key);
    }
    void save({ ...settings!, enabledSources: [...cur] });
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
        {msg ? <p className="mt-1 text-xs text-muted-foreground">{msg}</p> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>账号</CardTitle>
          <CardDescription>
            源站登录、Cookie、重新登录已移至「账号」页面
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/accounts">打开账号管理</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>启用源</CardTitle>
          <CardDescription>
            关闭的源不会出现在探索 / 搜索 / 账号列表（至少保留一个）
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(catalog.length
            ? catalog
            : settings.enabledSources.map((k) => ({ key: k, name: k }))
          ).map((s) => {
            const on = settings.enabledSources.includes(s.key);
            return (
              <Button
                key={s.key}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                className="rounded-full"
                onClick={() => toggleSource(s.key)}
              >
                {s.name}
                {on ? "" : "（关）"}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>阅读</CardTitle>
          <CardDescription>
            默认阅读模式与翻页预读（阅读页内切换模式也会写回这里）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="reader-mode" className="text-muted-foreground">
              默认模式
            </Label>
            <Select
              value={settings.readerMode}
              onValueChange={(value) =>
                void save({
                  ...settings,
                  readerMode: value as AppSettings["readerMode"],
                })
              }
            >
              <SelectTrigger id="reader-mode" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scroll">滚动</SelectItem>
                <SelectItem value="ltr">左→右</SelectItem>
                <SelectItem value="rtl">右→左</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="preload-count" className="text-muted-foreground">
              预读页数
            </Label>
            <Select
              value={String(settings.preloadCount)}
              onValueChange={(value) =>
                void save({
                  ...settings,
                  preloadCount: Number(value),
                })
              }
            >
              <SelectTrigger id="preload-count" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 5, 8].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 0 ? "关闭" : `前后各 ${n} 页`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日志</CardTitle>
          <CardDescription>
            服务端日志等级（默认 warn，不刷请求访问日志）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="log-level" className="text-muted-foreground">
              等级
            </Label>
            <Select
              value={settings.logLevel ?? "warn"}
              onValueChange={(value) =>
                void save({
                  ...settings,
                  logLevel: value as LogLevel,
                })
              }
            >
              <SelectTrigger id="log-level" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="silent">关闭</SelectItem>
                <SelectItem value="error">error</SelectItem>
                <SelectItem value="warn">warn（默认）</SelectItem>
                <SelectItem value="info">info（含请求）</SelectItem>
                <SelectItem value="debug">debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>出站代理</CardTitle>
          <CardDescription>
            可选 HTTP(S) 代理，供服务端请求源站（保存后立即生效）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="http://127.0.0.1:7890"
            value={settings.httpProxy || ""}
            onChange={(e) =>
              setSettings({ ...settings, httpProxy: e.target.value })
            }
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void save({
                ...settings,
                // empty string clears proxy (do not omit — omit falls back to env)
                httpProxy: settings.httpProxy?.trim() || "",
              }).then(() => setMsg("代理已保存"))
            }
          >
            保存代理
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WebDAV 同步</CardTitle>
          <CardDescription>同步收藏与历史到远端</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="https://dav.example.com/remote.php/dav/files/user"
            value={settings.webdav?.url || ""}
            onChange={(e) =>
              setSettings({
                ...settings,
                webdav: { ...settings.webdav, url: e.target.value },
              })
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="用户名"
              value={settings.webdav?.username || ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  webdav: { ...settings.webdav, username: e.target.value },
                })
              }
            />
            <Input
              type="password"
              placeholder="密码"
              value={settings.webdav?.password || ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  webdav: { ...settings.webdav, password: e.target.value },
                })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void save(settings).then(() => setMsg("WebDAV 配置已保存"))
              }
            >
              保存配置
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void unwrap(client.sync.webdav.push.$post())
                  .then(() => setMsg("已推送"))
                  .catch((e) => setMsg(e.message))
              }
            >
              推送
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void unwrap(client.sync.webdav.pull.$post())
                  .then(() => setMsg("已拉取"))
                  .catch((e) => setMsg(e.message))
              }
            >
              拉取
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
