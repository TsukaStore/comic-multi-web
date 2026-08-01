/**
 * Proxy settings must install ProxyAgent and clear back to a plain Agent.
 * Run: pnpm --filter server test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Agent, ProxyAgent, getGlobalDispatcher } from "undici";

import { applyHttpProxyFromSettings } from "./client.ts";

describe("applyHttpProxyFromSettings", () => {
  it("installs ProxyAgent when url set, and Agent when cleared", () => {
    applyHttpProxyFromSettings("http://127.0.0.1:9");
    assert.ok(
      getGlobalDispatcher() instanceof ProxyAgent,
      "expected ProxyAgent after set",
    );

    applyHttpProxyFromSettings("");
    assert.ok(
      getGlobalDispatcher() instanceof Agent,
      "expected default Agent after clear",
    );
    assert.equal(
      getGlobalDispatcher() instanceof ProxyAgent,
      false,
      "ProxyAgent must not remain after clear",
    );
  });
});
