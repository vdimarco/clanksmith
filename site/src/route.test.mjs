import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apexRedirect, isRelayPath } from "./route.mjs";
import { isMcpPath } from "../../mcp/http.mjs";

test("www redirects to the apex and keeps the path and query", () => {
  const next = apexRedirect(new URL("https://www.clanksmith.com/mcp?x=1"));
  assert.equal(next.toString(), "https://clanksmith.com/mcp?x=1");
  assert.equal(apexRedirect(new URL("https://clanksmith.com/")), null);
  assert.equal(apexRedirect(new URL("https://clanksmith.vdimarco.workers.dev/")), null);
});

test("only /mcp is the relay", () => {
  assert.equal(isRelayPath("/mcp"), true);
  assert.equal(isRelayPath("/mcp/"), true);
  assert.equal(isRelayPath("/"), false);
  assert.equal(isRelayPath("/board/"), false);
  assert.equal(isRelayPath("/mcp/extra"), false);
  assert.equal(isMcpPath("/mcp"), true);
  assert.equal(isMcpPath("/mcp/"), true);
});

test("the worker redirects www, serves assets, and exports the relay", () => {
  const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.match(worker, /apexRedirect/);
  assert.match(worker, /isRelayPath/);
  assert.match(worker, /env\.ASSETS\.fetch/);
  assert.match(worker, /export \{ ClanksmithRelay \}/);
  assert.equal(worker.includes("aat_"), false);
});
