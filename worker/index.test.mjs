import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "./site.mjs";

const env = {
  ASSETS: {
    fetch(request) {
      const path = new URL(request.url).pathname;
      const status = path === "/missing" ? 404 : 200;
      return new Response(status === 404 ? "missing" : "ok", {
        status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  },
};

test("asset responses keep the v3 security headers", async () => {
  const home = await handleRequest(new Request("https://clanksmith.com/"), env);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.equal(home.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(home.headers.get("content-security-policy"), null);

  const missing = await handleRequest(new Request("https://clanksmith.com/missing"), env);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-frame-options"), "DENY");
});

test("www and plain HTTP redirect to the apex", async () => {
  const www = await handleRequest(new Request("https://www.clanksmith.com/?x=1"), env);
  assert.equal(www.status, 301);
  assert.equal(www.headers.get("location"), "https://clanksmith.com/?x=1");
  const http = await handleRequest(new Request("http://clanksmith.com/motion.js"), env);
  assert.equal(http.status, 301);
  assert.equal(http.headers.get("location"), "https://clanksmith.com/motion.js");
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
