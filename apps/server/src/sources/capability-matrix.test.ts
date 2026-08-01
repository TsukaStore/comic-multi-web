/**
 * Structural tests: every adapter capability maps to real methods + explore metadata,
 * and web routes expose the corresponding surfaces.
 * Run: pnpm --filter server test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { ALL_SOURCES, buildCapabilityMatrix } from "./registry.ts";

const webRoutes = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../web/src/routes",
);

describe("capability matrix (adapters)", () => {
  const matrix = buildCapabilityMatrix();

  it("covers all four built-in sources", () => {
    assert.deepEqual(
      matrix.map((r) => r.key).sort(),
      ["ehentai", "jm", "nhentai", "picacg"].sort(),
    );
  });

  it("search capability implies searchOptions default path exists", () => {
    for (const row of matrix) {
      assert.equal(typeof row.capabilities.search, "boolean");
      if (row.capabilities.search) {
        // options may be empty (eh) but search method must exist
        const src = ALL_SOURCES.find((s) => s.key === row.key)!;
        assert.equal(typeof src.search, "function");
      }
    }
  });

  it("category true implies getCategories + loadCategory", () => {
    for (const row of matrix) {
      if (!row.capabilities.category) continue;
      assert.equal(
        row.methods.getCategories,
        true,
        `${row.key} category without getCategories`,
      );
      assert.equal(
        row.methods.loadCategory,
        true,
        `${row.key} category without loadCategory`,
      );
    }
  });

  it("ranking true implies loadRanking + rankingOptions", () => {
    for (const row of matrix) {
      if (!row.capabilities.ranking) continue;
      assert.equal(
        row.methods.loadRanking,
        true,
        `${row.key} ranking without loadRanking`,
      );
      assert.ok(
        row.rankingOptions.length > 0,
        `${row.key} ranking without rankingOptions metadata`,
      );
    }
  });

  it("every source exposes at least one explore page key", () => {
    for (const row of matrix) {
      assert.ok(
        row.explorePages.length >= 1,
        `${row.key} missing explore pages`,
      );
      assert.ok(row.explorePages.every((p) => p.key && p.title));
    }
  });

  it("networkFavorites capability implies getNetworkFavorites", () => {
    for (const row of matrix) {
      if (!row.capabilities.networkFavorites) continue;
      assert.equal(
        row.methods.getNetworkFavorites,
        true,
        `${row.key} networkFavorites without method`,
      );
    }
  });

  it("multi-key explore sources (jm/eh) list more than home", () => {
    const jm = matrix.find((r) => r.key === "jm")!;
    const eh = matrix.find((r) => r.key === "ehentai")!;
    assert.ok(jm.explorePages.length >= 2, "jm should expose home + latest");
    assert.ok(eh.explorePages.length >= 2, "eh should expose home + popular");
  });

  it("web index wires explore/category/ranking modes from source metadata", () => {
    const index = fs.readFileSync(path.join(webRoutes, "index.tsx"), "utf8");
    assert.match(index, /mode === "explore"/);
    assert.match(index, /mode === "category"/);
    assert.match(index, /mode === "ranking"/);
    assert.match(index, /explorePages/);
    assert.match(index, /rankingOptions/);
    assert.match(index, /unwrap\(\s*client\.sources/);
  });

  it("web settings writes enabledSources, readerMode, preloadCount, httpProxy, logLevel", () => {
    const settings = fs.readFileSync(
      path.join(webRoutes, "settings.tsx"),
      "utf8",
    );
    assert.match(settings, /enabledSources/);
    assert.match(settings, /readerMode/);
    assert.match(settings, /preloadCount/);
    assert.match(settings, /httpProxy/);
    assert.match(settings, /logLevel/);
    assert.match(settings, /sources\.catalog/);
    assert.match(settings, /unwrap\(\s*client\.settings\.\$put/);
  });

  it("web reader can switch ep without leaving reader shell", () => {
    const read = fs.readFileSync(
      path.join(webRoutes, "read.$sourceKey.$id.tsx"),
      "utf8",
    );
    assert.match(read, /function switchEp/);
    assert.match(read, /ep: nextEp/);
    assert.match(read, /chapters\.length > 1/);
    assert.match(read, /unwrap\(\s*client\.local\.history\.\$put/);
  });
});
