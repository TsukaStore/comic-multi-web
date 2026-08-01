import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { client, unwrap, type AppSettings } from "@/api/client";
import { Spinner } from "@/components/feedback";

type ReaderMode = AppSettings["readerMode"];

type ReadSearch = {
  ep?: string;
  page?: number;
};

export const Route = createFileRoute("/read/$sourceKey/$id")({
  validateSearch: (s: Record<string, unknown>): ReadSearch => ({
    ep: typeof s.ep === "string" ? s.ep : "1",
    page: Number.isFinite(Number(s.page)) ? Number(s.page) : 0,
  }),
  component: ReaderPage,
});

const SWIPE_MIN = 48;
const TAP_MAX_MOVE = 12;

function ReaderPage() {
  const { sourceKey, id } = Route.useParams();
  const { ep = "1", page = 0 } = Route.useSearch();
  const navigate = useNavigate({ from: "/read/$sourceKey/$id" });
  const [pages, setPages] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState("");
  const [chapters, setChapters] = useState<[string, string][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUi, setShowUi] = useState(true);
  const [mode, setMode] = useState<ReaderMode>("scroll");
  const [preloadCount, setPreloadCount] = useState(3);
  const [settingsReady, setSettingsReady] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipedRef = useRef(false);
  const settingsRef = useRef<AppSettings | null>(null);

  // Load default reader mode + preload from settings
  useEffect(() => {
    void unwrap(client.settings.$get())
      .then((s) => {
        settingsRef.current = s;
        setMode(s.readerMode || "scroll");
        setPreloadCount(
          typeof s.preloadCount === "number" ? s.preloadCount : 3,
        );
      })
      .catch(() => undefined)
      .finally(() => setSettingsReady(true));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      unwrap(
        client.sources[":key"].comics[":id"].$get({
          param: { key: sourceKey, id },
        }),
      ),
      unwrap(
        client.sources[":key"].comics[":id"].pages.$get({
          param: { key: sourceKey, id },
          query: ep ? { ep } : {},
        }),
      ),
    ])
      .then(([info, p]) => {
        setTitle(info.title);
        setCover(info.cover);
        setPages(p.pages);
        const ch = Object.entries(info.chapters ?? {});
        setChapters(ch.length ? ch : [["1", "本话"]]);
        void unwrap(
          client.local.history.$put({
            json: {
              sourceKey,
              comicId: id,
              title: info.title,
              cover: info.cover,
              ep,
              page,
            },
          }),
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sourceKey, id, ep]);

  const goPage = useCallback(
    (next: number) => {
      if (!pages.length) return;
      const clamped = Math.max(0, Math.min(pages.length - 1, next));
      if (clamped === page) return;
      void navigate({ search: (s) => ({ ...s, page: clamped }) });
      void unwrap(
        client.local.history.$put({
          json: {
            sourceKey,
            comicId: id,
            title,
            cover,
            ep,
            page: clamped,
          },
        }),
      );
    },
    [pages.length, page, navigate, sourceKey, id, title, cover, ep],
  );

  const stepPage = useCallback(
    (dir: 1 | -1) => {
      // dir: +1 = forward in reading order, -1 = backward
      if (mode === "ltr") goPage(page + dir);
      else if (mode === "rtl") goPage(page - dir);
    },
    [mode, page, goPage],
  );

  // Persist mode when user changes it (becomes new default)
  async function changeMode(next: ReaderMode) {
    setMode(next);
    const cur = settingsRef.current;
    if (!cur || cur.readerMode === next) return;
    const nextSettings = { ...cur, readerMode: next };
    settingsRef.current = nextSettings;
    try {
      await unwrap(client.settings.$put({ json: nextSettings }));
    } catch {
      /* ignore */
    }
  }

  // Preload neighbors in page modes
  useEffect(() => {
    if (mode === "scroll" || !pages.length || preloadCount <= 0) return;
    const imgs: HTMLImageElement[] = [];
    for (let d = 1; d <= preloadCount; d++) {
      for (const i of [page + d, page - d]) {
        if (i < 0 || i >= pages.length) continue;
        const src = pages[i];
        if (!src) continue;
        const img = new Image();
        img.src = src;
        imgs.push(img);
      }
    }
    return () => {
      for (const img of imgs) img.src = "";
    };
  }, [mode, page, pages, preloadCount]);

  // Keyboard + volume keys
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (mode === "scroll") {
        if (
          e.key === "ArrowDown" ||
          e.key === " " ||
          e.key === "PageDown" ||
          e.key === "j"
        ) {
          e.preventDefault();
          window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" });
        }
        if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") {
          e.preventDefault();
          window.scrollBy({
            top: -window.innerHeight * 0.9,
            behavior: "smooth",
          });
        }
        return;
      }

      // ltr / rtl — screen right / left / volume
      if (
        e.key === "ArrowRight" ||
        e.key === "PageDown" ||
        e.key === " " ||
        e.key === "d" ||
        e.key === "l"
      ) {
        e.preventDefault();
        // physical right side of screen → forward for ltr, back for rtl
        if (mode === "ltr") goPage(page + 1);
        else goPage(page - 1);
      }
      if (
        e.key === "ArrowLeft" ||
        e.key === "PageUp" ||
        e.key === "a" ||
        e.key === "h"
      ) {
        e.preventDefault();
        if (mode === "ltr") goPage(page - 1);
        else goPage(page + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, page, goPage]);

  function bumpUi() {
    setShowUi(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowUi(false), 2500);
  }

  function toggleUi() {
    setShowUi((v) => {
      if (!v) {
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setShowUi(false), 2500);
        return true;
      }
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      return false;
    });
  }

  function switchEp(nextEp: string) {
    if (nextEp === ep) return;
    void navigate({ search: (s) => ({ ...s, ep: nextEp, page: 0 }) });
    bumpUi();
  }

  useEffect(() => {
    bumpUi();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    if (!t) return;
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    swipedRef.current = false;
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (mode === "scroll") {
      // vertical scroll native; only treat clear horizontal as UI toggle
      if (adx < TAP_MAX_MOVE && ady < TAP_MAX_MOVE) {
        toggleUi();
      }
      return;
    }

    // page modes: horizontal swipe
    if (adx >= SWIPE_MIN && adx > ady * 1.2) {
      swipedRef.current = true;
      // swipe left → content moves left → next in ltr
      if (dx < 0) {
        if (mode === "ltr") goPage(page + 1);
        else goPage(page - 1);
      } else {
        if (mode === "ltr") goPage(page - 1);
        else goPage(page + 1);
      }
      bumpUi();
      return;
    }

    // tap
    if (adx < TAP_MAX_MOVE && ady < TAP_MAX_MOVE) {
      const x = t.clientX / window.innerWidth;
      if (x > 0.66) {
        // right third
        if (mode === "ltr") goPage(page + 1);
        else goPage(page - 1);
      } else if (x < 0.34) {
        if (mode === "ltr") goPage(page - 1);
        else goPage(page + 1);
      } else {
        toggleUi();
      }
    }
  }

  function onPageClick(e: React.MouseEvent) {
    // skip if this follows a touch swipe (synthetic click)
    if (swipedRef.current) {
      swipedRef.current = false;
      e.preventDefault();
      return;
    }
    // ignore pure touch devices that already handled in touchend
    if (e.detail === 0) return;

    const x = e.clientX / window.innerWidth;
    if (x > 0.66) {
      if (mode === "ltr") goPage(page + 1);
      else goPage(page - 1);
    } else if (x < 0.34) {
      if (mode === "ltr") goPage(page - 1);
      else goPage(page + 1);
    } else {
      toggleUi();
    }
  }

  if (loading || !settingsReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner label="加载页面…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-sm text-destructive">
        {error}
        <Link
          to="/comic/$sourceKey/$id"
          params={{ sourceKey, id }}
          className="text-muted-foreground hover:text-foreground"
        >
          返回详情
        </Link>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen touch-pan-y select-none bg-background"
      onMouseMove={bumpUi}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className={`fixed inset-x-0 top-0 z-30 flex min-w-0 items-center gap-2 border-b border-border bg-background/85 px-3 py-3 pt-[max(0.75rem,var(--safe-top))] backdrop-blur transition-opacity sm:gap-3 sm:px-4 sm:py-3.5 ${
          showUi ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <Link
          to="/comic/$sourceKey/$id"
          params={{ sourceKey, id }}
          className="min-h-touch inline-flex shrink-0 items-center text-base text-muted-foreground hover:text-foreground"
        >
          ← 返回
        </Link>
        <div className="min-w-0 flex-1 truncate text-sm sm:text-base">{title}</div>
        {chapters.length > 1 ? (
          <select
            value={ep}
            onChange={(e) => switchEp(e.target.value)}
            className="min-h-touch max-w-[8rem] shrink-0 truncate rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            title="章节"
          >
            {chapters.map(([k, name]) => (
              <option key={k} value={k}>
                {name || k}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={mode}
          onChange={(e) => void changeMode(e.target.value as ReaderMode)}
          className="min-h-touch max-w-[7.5rem] shrink-0 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
        >
          <option value="scroll">滚动</option>
          <option value="ltr">左→右</option>
          <option value="rtl">右→左</option>
        </select>
        <span className="shrink-0 text-xs text-muted-foreground sm:text-sm">
          {mode === "scroll"
            ? `${pages.length}p`
            : `${page + 1}/${pages.length}`}
        </span>
      </div>

      {mode === "scroll" ? (
        <div
          className="mx-auto flex max-w-3xl flex-col gap-1 pt-[calc(3.75rem+var(--safe-top))] pb-[calc(5rem+var(--safe-bottom))]"
          onClick={() => toggleUi()}
        >
          {pages.map((src, i) => (
            <img
              key={src + i}
              src={src}
              alt={`p${i + 1}`}
              loading={i < 2 + preloadCount ? "eager" : "lazy"}
              decoding="async"
              draggable={false}
              className="w-full bg-muted"
            />
          ))}
        </div>
      ) : (
        <div
          className="flex min-h-screen items-center justify-center px-1 pt-[calc(3.5rem+var(--safe-top))] pb-safe sm:px-2"
          onClick={onPageClick}
        >
          {pages[page] ? (
            <img
              key={pages[page]}
              src={pages[page]}
              alt={`p${page + 1}`}
              draggable={false}
              decoding="async"
              className="max-h-[92dvh] max-w-full object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">无此页</p>
          )}
          {/* edge hints (subtle) */}
          <div className="pointer-events-none fixed inset-y-0 left-0 w-[12%] max-w-16" />
          <div className="pointer-events-none fixed inset-y-0 right-0 w-[12%] max-w-16" />
        </div>
      )}

      {/* bottom bar for page modes */}
      {mode !== "scroll" && showUi ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-4 border-t border-border bg-background/85 px-4 py-3 pb-[max(0.75rem,var(--safe-bottom))] backdrop-blur"
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="min-h-touch min-w-touch rounded-md border border-border px-4 text-sm"
            onClick={() => stepPage(-1)}
          >
            上一页
          </button>
          <span className="min-w-[4.5rem] text-center text-sm text-muted-foreground">
            {page + 1} / {pages.length}
          </span>
          <button
            type="button"
            className="min-h-touch min-w-touch rounded-md border border-border px-4 text-sm"
            onClick={() => stepPage(1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}
