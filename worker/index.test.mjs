import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { handleRequest } from "./site.mjs";
import { handleMcp, nodeToRequest } from "../mcp/http.mjs";

const env = {
  ASSETS: {
    fetch(request) {
      const path = new URL(request.url).pathname;
      const status = path === "/missing" ? 404 : 200;
      const type = path.startsWith("/fonts/") ? "font/woff2" : path.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
      return new Response(status === 404 ? "missing" : "ok", { status, headers: { "content-type": type } });
    },
  },
};

test("site Worker preserves redirects, cache rules, and board feed access", async () => {
  const get = (url) => handleRequest(new Request(url), env);
  const home = await get("https://clanksmith.com/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /connect-src 'self' https:\/\/rpc\.mainnet/);
  assert.match(home.headers.get("content-security-policy"), /script-src 'self' https:\/\/static\.cloudflareinsights\.com/);
  assert.doesNotMatch(home.headers.get("content-security-policy"), /connect-src 'self' https:;/);
  assert.equal(home.headers.get("cache-control"), "public, max-age=300");

  const board = await get("https://clanksmith.com/board/");
  assert.match(board.headers.get("content-security-policy"), /connect-src 'self' https:;/);
  assert.equal((await get("https://clanksmith.com/board/board.css")).headers.get("cache-control"), "public, max-age=300");
  assert.equal((await get("https://clanksmith.com/fonts/big-shoulders-display.woff2")).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await get("https://clanksmith.com/missing")).headers.get("cache-control"), "no-store");

  const redirect = await get("https://www.clanksmith.com/board/?x=feed");
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "https://clanksmith.com/board/?x=feed");
  assert.equal((await get("http://clanksmith.com/")).headers.get("location"), "https://clanksmith.com/");
});

test("/mcp goes to the relay and www still redirects", async () => {
  let assets = 0;
  const counting = {
    ASSETS: {
      fetch() {
        assets += 1;
        return new Response("asset");
      },
    },
  };
  const mcp = await handleRequest(new Request("https://clanksmith.com/mcp"), counting, {
    relay() { return new Response("mcp", { status: 200 }); },
  });
  assert.equal(mcp.status, 200);
  assert.equal(await mcp.text(), "mcp");
  assert.equal(assets, 0);

  const slash = await handleRequest(new Request("https://clanksmith.com/mcp/?q=1"), counting, {
    relay(request) {
      assert.equal(new URL(request.url).pathname, "/mcp");
      assert.equal(new URL(request.url).search, "?q=1");
      return new Response("ok");
    },
  });
  assert.equal(slash.status, 200);

  const www = await handleRequest(new Request("https://www.clanksmith.com/mcp?x=1"), counting, {
    relay() { throw new Error("www should redirect before the relay"); },
  });
  assert.equal(www.status, 301);
  assert.equal(www.headers.get("location"), "https://clanksmith.com/mcp?x=1");
});

test("MCP rejects oversized bodies before schema parsing or dispatch", async () => {
  const body = "x".repeat(129 * 1024);
  const response = await handleMcp(new Request("https://clanksmith.com/mcp", { method: "POST", body }), {
    dispatch() { throw new Error("oversized request reached dispatch"); },
  });
  assert.equal(response.status, 413);
  assert.match(await response.text(), /too large/);

  const incoming = Object.assign(Readable.from([Buffer.from(body)]), {
    headers: { host: "localhost" }, method: "POST", url: "/mcp",
  });
  await assert.rejects(nodeToRequest(incoming), { status: 413 });
});

test("MCP still handles a normal initialize request", async () => {
  const request = new Request("https://clanksmith.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "audit", version: "1" },
    } }),
  });
  const response = await handleMcp(request, { dispatch() { throw new Error("initialize should not dispatch"); } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.serverInfo.name, "clanksmith");
});
