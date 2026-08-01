import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Loader2, LogOut, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { client, unwrap, type AccountStatus } from "@/api/client";
import { Spinner } from "@/components/feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/accounts")({
  component: AccountsPage,
});

function AccountsPage() {
  const [list, setList] = useState<AccountStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setList(await unwrap(client.accounts.$get()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function setField(sourceKey: string, key: string, value: string) {
    setForms((m) => ({
      ...m,
      [sourceKey]: { ...m[sourceKey], [key]: value },
    }));
  }

  function clientUa() {
    return typeof navigator !== "undefined" ? navigator.userAgent : "";
  }

  function fieldValue(sourceKey: string, key: string, fallback = "") {
    const v = forms[sourceKey]?.[key];
    if (v !== undefined) return v;
    return fallback;
  }

  async function doLogin(acc: AccountStatus) {
    const fields = { ...forms[acc.sourceKey] };
    if (acc.loginMode === "cookies" && !fields.ua?.trim()) {
      fields.ua = clientUa();
    }
    setBusy((m) => ({ ...m, [acc.sourceKey]: "login" }));
    setMsg("");
    try {
      const body =
        acc.loginMode === "password"
          ? {
              username: fields.username || "",
              password: fields.password || "",
              fields,
            }
          : acc.loginMode === "cookies"
            ? {
                cookie: fields.cookie || "",
                fields,
                cookies: fields,
                extra: { ua: fields.ua || clientUa() },
              }
            : {
                cookies: fields,
                fields,
                cookie: fields.cookie || "",
                username: fields.ipb_member_id,
                password: fields.ipb_pass_hash,
              };

      const next = await unwrap(
        client.sources[":key"].login.$post({
          param: { key: acc.sourceKey },
          json: body,
        }),
      );
      setList((prev) =>
        prev.map((a) => (a.sourceKey === acc.sourceKey ? next : a)),
      );
      setMsg(`${acc.name} 登录成功`);
      setForms((m) => ({ ...m, [acc.sourceKey]: {} }));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy((m) => {
        const n = { ...m };
        delete n[acc.sourceKey];
        return n;
      });
    }
  }

  async function doReLogin(acc: AccountStatus) {
    setBusy((m) => ({ ...m, [acc.sourceKey]: "relogin" }));
    setMsg("");
    try {
      const next = await unwrap(
        client.sources[":key"].relogin.$post({
          param: { key: acc.sourceKey },
        }),
      );
      setList((prev) =>
        prev.map((a) => (a.sourceKey === acc.sourceKey ? next : a)),
      );
      setMsg(`${acc.name} 重新登录成功`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy((m) => {
        const n = { ...m };
        delete n[acc.sourceKey];
        return n;
      });
    }
  }

  async function doLogout(acc: AccountStatus) {
    setBusy((m) => ({ ...m, [acc.sourceKey]: "logout" }));
    try {
      const next = await unwrap(
        client.sources[":key"].logout.$post({
          param: { key: acc.sourceKey },
        }),
      );
      setList((prev) =>
        prev.map((a) => (a.sourceKey === acc.sourceKey ? next : a)),
      );
      setMsg(`${acc.name} 已退出`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy((m) => {
        const n = { ...m };
        delete n[acc.sourceKey];
        return n;
      });
    }
  }

  async function doAction(acc: AccountStatus, actionKey: string) {
    setBusy((m) => ({ ...m, [acc.sourceKey]: `action:${actionKey}` }));
    setMsg("");
    try {
      const res = await unwrap(
        client.sources[":key"].account.actions.$post({
          param: { key: acc.sourceKey },
          json: { action: actionKey },
        }),
      );
      setList((prev) =>
        prev.map((a) => (a.sourceKey === acc.sourceKey ? res.account : a)),
      );
      setMsg(res.message || `${acc.name} 操作完成`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy((m) => {
        const n = { ...m };
        delete n[acc.sourceKey];
        return n;
      });
    }
  }

  async function setOption(acc: AccountStatus, key: string, value: string) {
    try {
      const next = await unwrap(
        client.sources[":key"].account.options.$put({
          param: { key: acc.sourceKey },
          json: { key, value },
        }),
      );
      setList((prev) =>
        prev.map((a) => (a.sourceKey === acc.sourceKey ? next : a)),
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  if (loading) return <Spinner label="加载账号…" />;

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">账号管理</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            各源独立登录、资料展示与重新登录
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          刷新
        </Button>
      </div>

      {msg ? (
        <Alert>
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!list.length ? (
        <p className="text-sm text-muted-foreground">没有支持账号的源</p>
      ) : null}

      {list.map((acc) => {
        const b = busy[acc.sourceKey];
        return (
          <Card key={acc.sourceKey}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{acc.name}</CardTitle>
                <Badge variant={acc.loggedIn ? "default" : "secondary"}>
                  {acc.loggedIn ? "已登录" : "未登录"}
                </Badge>
              </div>
              <CardDescription className="font-mono text-xs">
                {acc.sourceKey} · {acc.loginMode}
              </CardDescription>
              {!acc.loggedIn && acc.description ? (
                <p className="pt-1 text-xs leading-relaxed text-muted-foreground wrap-anywhere">
                  {acc.description}
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {acc.loggedIn ? (
                <>
                  {acc.infoItems.length ? (
                    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                      {acc.infoItems.map((item) => (
                        <div
                          key={item.title}
                          className="flex justify-between gap-4 text-sm"
                        >
                          <span className="text-muted-foreground">{item.title}</span>
                          <span className="max-w-[60%] min-w-0 break-all text-right">
                            {item.value || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {acc.options?.map((opt) =>
                    opt.type === "select" ? (
                      <div
                        key={opt.key}
                        className="flex items-center justify-between gap-3"
                      >
                        <Label className="text-muted-foreground">{opt.label}</Label>
                        <Select
                          value={String(opt.value)}
                          onValueChange={(v) => void setOption(acc, opt.key, v)}
                        >
                          <SelectTrigger className="w-[min(100%,16rem)] max-w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(opt.choices || []).map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null,
                  )}

                  {acc.actions?.length ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {acc.actions.map((act) => {
                          const actionBusy = b === `action:${act.key}`;
                          return (
                            <Button
                              key={act.key}
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={Boolean(b)}
                              onClick={() => void doAction(acc, act.key)}
                            >
                              {actionBusy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Server className="size-4" />
                              )}
                              {act.label}
                            </Button>
                          );
                        })}
                      </div>
                      {acc.actions.map((act) =>
                        act.hint ? (
                          <p
                            key={`${act.key}-hint`}
                            className="text-xs text-muted-foreground"
                          >
                            {act.hint}
                          </p>
                        ) : null,
                      )}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {acc.allowReLogin ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={Boolean(b)}
                        onClick={() => void doReLogin(acc)}
                      >
                        {b === "relogin" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        重新登录
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(b)}
                      onClick={() => void doLogout(acc)}
                    >
                      {b === "logout" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <LogOut className="size-4" />
                      )}
                      退出登录
                    </Button>
                  </div>
                  {acc.allowReLogin ? (
                    <p className="text-xs text-muted-foreground">
                      登录失效时可点「重新登录」，使用已保存的账号密码刷新
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  {acc.options?.map((opt) =>
                    opt.type === "select" ? (
                      <div
                        key={opt.key}
                        className="flex items-center justify-between gap-3"
                      >
                        <Label className="text-muted-foreground">{opt.label}</Label>
                        <Select
                          value={String(opt.value)}
                          onValueChange={(v) => void setOption(acc, opt.key, v)}
                        >
                          <SelectTrigger className="w-[min(100%,16rem)] max-w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(opt.choices || []).map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null,
                  )}

                  {acc.actions?.length ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {acc.actions.map((act) => {
                          const actionBusy = b === `action:${act.key}`;
                          return (
                            <Button
                              key={act.key}
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={Boolean(b)}
                              onClick={() => void doAction(acc, act.key)}
                            >
                              {actionBusy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Server className="size-4" />
                              )}
                              {act.label}
                            </Button>
                          );
                        })}
                      </div>
                      {acc.actions.map((act) =>
                        act.hint ? (
                          <p
                            key={`${act.key}-hint`}
                            className="text-xs text-muted-foreground"
                          >
                            {act.hint}
                          </p>
                        ) : null,
                      )}
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {acc.fields.map((f) => {
                      const isUa = f.key === "ua";
                      const value = fieldValue(
                        acc.sourceKey,
                        f.key,
                        isUa ? clientUa() : "",
                      );
                      return (
                        <div key={f.key} className="space-y-1.5">
                          <Label htmlFor={`${acc.sourceKey}-${f.key}`}>
                            {f.label}
                            {f.required ? "" : "（可选）"}
                          </Label>
                          {f.type === "textarea" ? (
                            <textarea
                              id={`${acc.sourceKey}-${f.key}`}
                              className="flex min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                              placeholder={f.placeholder}
                              value={value}
                              onChange={(e) =>
                                setField(acc.sourceKey, f.key, e.target.value)
                              }
                            />
                          ) : (
                            <Input
                              id={`${acc.sourceKey}-${f.key}`}
                              type={f.type === "password" ? "password" : "text"}
                              placeholder={
                                isUa ? clientUa() || f.placeholder : f.placeholder
                              }
                              value={value}
                              onChange={(e) =>
                                setField(acc.sourceKey, f.key, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void doLogin(acc);
                              }}
                            />
                          )}
                          {f.hint ? (
                            <p className="text-xs text-muted-foreground">{f.hint}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={Boolean(b)}
                      onClick={() => void doLogin(acc)}
                    >
                      {b === "login" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      登录
                    </Button>
                    {acc.registerUrl ? (
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={acc.registerUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          注册
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
