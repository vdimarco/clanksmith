import assert from "node:assert/strict";
import test from "node:test";
import worker from "./index.js";

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
  const get = (url) => worker.fetch(new Request(url), env);
  const home = await get("https://clanksmith.com/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /connect-src 'self' https:\/\/rpc\.mainnet/);
  assert.doesNotMatch(home.headers.get("content-security-policy"), /connect-src 'self' https:;/);
  assert.equal(home.headers.get("cache-control"), "public, max-age=300");

  const board = await get("https://clanksmith.com/board/");
  assert.match(board.headers.get("content-security-policy"), /connect-src 'self' https:;/);
  assert.equal((await get("https://clanksmith.com/board/board.css")).headers.get("cache-control"), "public, max-age=300");
  assert.equal((await get("https://clanksmith.com/fonts/outfit-400.woff2")).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await get("https://clanksmith.com/missing")).headers.get("cache-control"), "no-store");

  const redirect = await get("https://www.clanksmith.com/board/?x=feed");
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "https://clanksmith.com/board/?x=feed");
  assert.equal((await get("http://clanksmith.com/")).headers.get("location"), "https://clanksmith.com/");
});
