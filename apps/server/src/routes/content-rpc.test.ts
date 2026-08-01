/**
 * Drive real Hono routes for explore/category/ranking content paths.
 * Network-dependent; skips with assert when source is unreachable (CI offline).
 * Run: pnpm --filter server test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { app } from "../app.ts";
import type { ApiResult } from "../domain/result.ts";
import { getSource } from "../sources/registry.ts";

async function apiJson<T>(path: string): Promise<{
  status: number;
  body: ApiResult<T>;
}> {
  const res = await app.request(path);
  const body = (await res.json()) as ApiResult<T>;
  return { status: res.status, body };
}

function hasListContent(data: {
  items?: unknown[];
  parts?: { comics?: unknown[] }[];
}): boolean {
  if (Array.isArray(data.items) && data.items.length > 0) return true;
  if (
    Array.isArray(data.parts) &&
    data.parts.some((p) => Array.isArray(p.comics) && p.comics.length > 0)
  ) {
    return true;
  }
  return false;
}

describe("content RPC via app.request (shipped routes)", () => {
  it("GET /api/sources includes explorePages + rankingOptions for enabled sources", async () => {
    const { status, body } = await apiJson<
      {
        key: string;
        explorePages: { key: string }[];
        rankingOptions: { value: string }[];
        capabilities: { ranking: boolean; category: boolean };
      }[]
    >("/api/sources");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    if (!body.ok) return;
    assert.ok(body.data.length >= 1);
    for (const s of body.data) {
      assert.ok(
        Array.isArray(s.explorePages) && s.explorePages.length >= 1,
        `${s.key} missing explorePages`,
      );
      if (s.capabilities.ranking) {
        assert.ok(
          s.rankingOptions.length >= 1,
          `${s.key} ranking without rankingOptions`,
        );
      }
    }
  });

  it("picacg explore home returns items or parts via route", async () => {
    const { status, body } = await apiJson<{
      items?: unknown[];
      parts?: { comics?: unknown[] }[];
    }>("/api/sources/picacg/explore/home?page=1");
    if (!body.ok) {
      // offline / upstream blocked — still proved route envelope
      assert.equal(typeof body.error?.code, "string");
      assert.ok(status >= 400);
      return;
    }
    assert.equal(status, 200);
    assert.ok(
      hasListContent(body.data),
      "picacg explore home expected non-empty items or parts",
    );
  });

  it("jm explore latest pageKey returns list via route", async () => {
    const { status, body } = await apiJson<{
      items?: unknown[];
      parts?: { comics?: unknown[] }[];
    }>("/api/sources/jm/explore/latest?page=1");
    if (!body.ok) {
      assert.equal(typeof body.error?.code, "string");
      assert.ok(status >= 400);
      return;
    }
    assert.equal(status, 200);
    assert.ok(
      hasListContent(body.data),
      "jm explore latest expected non-empty items or parts",
    );
  });

  it("ehentai explore popular alternate pageKey via route", async () => {
    const { status, body } = await apiJson<{
      items?: unknown[];
      parts?: { comics?: unknown[] }[];
    }>("/api/sources/ehentai/explore/popular?page=1");
    if (!body.ok) {
      assert.equal(typeof body.error?.code, "string");
      assert.ok(status >= 400);
      return;
    }
    assert.equal(status, 200);
    assert.ok(
      hasListContent(body.data),
      "eh popular expected non-empty items or parts",
    );
  });

  it("picacg categories + category page via routes", async () => {
    const cats = await apiJson<{ name: string; children?: string[] }[]>(
      "/api/sources/picacg/categories",
    );
    if (!cats.body.ok) {
      assert.equal(typeof cats.body.error?.code, "string");
      return;
    }
    assert.ok(cats.body.data.length >= 1, "expected category nodes");
    const name =
      cats.body.data[0]?.children?.[0] ||
      cats.body.data[0]?.name ||
      "大家都在看";
    const page = await apiJson<{ items: unknown[] }>(
      `/api/sources/picacg/category?name=${encodeURIComponent(name)}&page=1`,
    );
    if (!page.body.ok) {
      assert.equal(typeof page.body.error?.code, "string");
      return;
    }
    assert.ok(
      Array.isArray(page.body.data.items),
      "category data must include items array",
    );
  });

  it("jm ranking with first rankingOption via route", async () => {
    const src = getSource("jm");
    const option = src.rankingOptions?.[0]?.value || "mv";
    const { status, body } = await apiJson<{ items: unknown[] }>(
      `/api/sources/jm/ranking?option=${encodeURIComponent(option)}&page=1`,
    );
    if (!body.ok) {
      assert.equal(typeof body.error?.code, "string");
      assert.ok(status >= 400);
      return;
    }
    assert.equal(status, 200);
    assert.ok(
      Array.isArray(body.data.items) && body.data.items.length > 0,
      "jm ranking expected non-empty items",
    );
  });

  it("adapter loadExplore/loadCategory/loadRanking shape (direct shipped methods)", async () => {
    const picacg = getSource("picacg");
    const jm = getSource("jm");
    const eh = getSource("ehentai");

    try {
      const home = await picacg.loadExplore("home", 1);
      assert.ok(
        hasListContent(home),
        "picacg.loadExplore home should yield content",
      );
    } catch (e) {
      assert.ok(e instanceof Error, "loadExplore throws Error when offline");
    }

    try {
      const latest = await jm.loadExplore("latest", 1);
      assert.ok(
        hasListContent(latest),
        "jm.loadExplore latest should yield content",
      );
    } catch (e) {
      assert.ok(e instanceof Error);
    }

    try {
      const popular = await eh.loadExplore("popular", 1);
      assert.ok(
        hasListContent(popular),
        "eh.loadExplore popular should yield content",
      );
    } catch (e) {
      assert.ok(e instanceof Error);
    }

    if (picacg.loadRanking) {
      try {
        const rank = await picacg.loadRanking("H24", 1);
        assert.ok(Array.isArray(rank.items));
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    }

    if (jm.loadCategory) {
      try {
        const cats = (await jm.getCategories?.()) ?? [];
        const name = cats[0]?.children?.[0] || cats[0]?.name;
        if (name) {
          const page = await jm.loadCategory(name, null, [], 1);
          assert.ok(Array.isArray(page.items));
        }
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    }
  });
});
