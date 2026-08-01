import { Loader2, Lock } from "lucide-react";
import {
  type FormEvent,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  ApiError,
  client,
  onUnauthorized,
  setAppToken,
  unwrap,
} from "@/api/client";
import { Brand } from "@/components/Brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Gate = "loading" | "locked" | "open";

export function AppAuthGate({ children }: PropsWithChildren) {
  const [gate, setGate] = useState<Gate>("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const status = await unwrap(client.auth.status.$get());
      if (!status.required || status.authenticated) {
        setGate("open");
      } else {
        setGate("locked");
      }
    } catch {
      // Network / older server without /auth/status — try a protected probe
      try {
        await unwrap(client.health.$get());
        await unwrap(client.sources.$get());
        setGate("open");
      } catch (e) {
        if (e instanceof ApiError && e.code === "UNAUTHORIZED") {
          setGate("locked");
        } else {
          // Unreachable API: still show app shell; pages will surface errors
          setGate("open");
        }
      }
    }
  }, []);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    return onUnauthorized(() => {
      setGate("locked");
      setPassword("");
      setError(null);
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await unwrap(
        client.auth.login.$post({ json: { password } }),
      );
      if ("token" in result && result.token) {
        setAppToken(result.token);
      }
      setPassword("");
      setGate("open");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "登录失败";
      setError(msg);
      setGate("locked");
    } finally {
      setSubmitting(false);
    }
  }

  if (gate === "loading") {
    return (
      <div className="flex h-dvh min-w-0 items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <span className="text-sm">检查访问权限…</span>
        </div>
      </div>
    );
  }

  if (gate === "locked") {
    return (
      <div className="flex h-dvh min-w-0 items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm ring-1 ring-foreground/5">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Lock className="size-5" />
            </div>
            <Brand compact className="pointer-events-none" />
            <p className="text-sm text-muted-foreground">
              此实例已启用访问口令，请先解锁后使用。
            </p>
          </div>

          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="app-password">访问口令</Label>
              <Input
                id="app-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="APP_PASSWORD"
                disabled={submitting}
              />
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting || !password}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  验证中…
                </>
              ) : (
                "解锁"
              )}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return children;
}
