import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REFRESH_EARLY_MS, createTokenKeeper, needsRefresh } from "./token.mjs";
import { warmScheduled } from "./schedule.mjs";

const CLIENT_ID = "c1JNLUNNZ2YwTXhGZlZFTzZ3M2Y6MTpjaQ";
const CLIENT_SECRET = "client-secret-value";
const NOW = Date.parse("2026-11-15T12:00:00.000Z");

function memory() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? { ...map.get(key) } : undefined; },
    async put(key, value) { map.set(key, { ...value }); },
    read(key) { return map.get(key); },
  };
}

function tokenResponse(access, refresh, expiresIn = 7200) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: access, refresh_token: refresh, expires_in: expiresIn }),
  };
}

function env(extra = {}) {
  return {
    X_CLIENT_ID: CLIENT_ID,
    X_CLIENT_SECRET: CLIENT_SECRET,
    X_OAUTH2_USER_TOKEN: "seed-access",
    X_OAUTH2_REFRESH_TOKEN: "seed-refresh",
    ...extra,
  };
}

test("a stored token is reused until it is inside the early window", () => {
  assert.equal(REFRESH_EARLY_MS, 30 * 60 * 1000);
  const fresh = { accessToken: "a", refreshToken: "r", expiresAt: NOW + REFRESH_EARLY_MS + 1 };
  const due = { accessToken: "a", refreshToken: "r", expiresAt: NOW + REFRESH_EARLY_MS };
  assert.equal(needsRefresh(fresh, NOW), false);
  assert.equal(needsRefresh(due, NOW), true);
  assert.equal(needsRefresh({ accessToken: "a", refreshToken: "", expiresAt: 0 }, NOW), false);
});

test("first use seeds the secrets, refreshes once, and stores the rotated refresh token", async () => {
  const storage = memory();
  const calls = [];
  const keeper = createTokenKeeper({
    storage,
    env: env(),
    now: () => NOW,
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return tokenResponse("access-2", "refresh-2");
    },
  });
  const token = await keeper.accessToken();
  const again = await keeper.accessToken();
  assert.equal(token, "access-2");
  assert.equal(again, "access-2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.x.com/2/oauth2/token");
  assert.equal(calls[0].opts.headers.authorization, "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET));
  assert.equal(calls[0].opts.headers["content-type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(calls[0].opts.body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "seed-refresh");
  assert.equal(form.get("client_id"), CLIENT_ID);
  assert.equal(form.get("client_secret"), null);
  const saved = storage.read("oauth2");
  assert.equal(saved.accessToken, "access-2");
  assert.equal(saved.refreshToken, "refresh-2");
  assert.equal(saved.expiresAt, NOW + 7200 * 1000);
  assert.equal(JSON.stringify(calls).includes(CLIENT_SECRET), false);
});

test("a fresh stored token wins over the seed secrets", async () => {
  const storage = memory();
  await storage.put("oauth2", {
    accessToken: "stored-access",
    refreshToken: "stored-refresh",
    expiresAt: NOW + 2 * 60 * 60 * 1000,
  });
  let calls = 0;
  const keeper = createTokenKeeper({
    storage,
    env: env(),
    now: () => NOW,
    fetchImpl: async () => { calls += 1; throw new Error("should not refresh"); },
  });
  assert.equal(await keeper.accessToken(), "stored-access");
  assert.equal(calls, 0);
  assert.equal(storage.read("oauth2").refreshToken, "stored-refresh");
});

test("concurrent callers share one refresh so the rotated token is not lost", async () => {
  const storage = memory();
  await storage.put("oauth2", { accessToken: "old-access", refreshToken: "refresh-1", expiresAt: NOW });
  let calls = 0;
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  const keeper = createTokenKeeper({
    storage,
    env: env({ X_OAUTH2_REFRESH_TOKEN: "stale-secret" }),
    now: () => NOW,
    fetchImpl: async () => {
      calls += 1;
      started();
      await gate;
      return tokenResponse("access-2", "refresh-2");
    },
  });
  const first = keeper.accessToken();
  const second = keeper.accessToken({ force: true, unacceptable: "old-access" });
  await entered;
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "access-2");
  assert.equal(await second, "access-2");
  assert.equal(calls, 1);
  assert.equal(storage.read("oauth2").refreshToken, "refresh-2");
});

test("a failed refresh keeps the previous refresh token and does not echo it", async () => {
  const storage = memory();
  await storage.put("oauth2", { accessToken: "old-access", refreshToken: "refresh-keep", expiresAt: NOW });
  const keeper = createTokenKeeper({
    storage,
    env: env({ X_OAUTH2_REFRESH_TOKEN: "refresh-keep" }),
    now: () => NOW,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_request", refresh_token: "refresh-keep" }) }),
  });
  await assert.rejects(keeper.accessToken(), (error) => {
    assert.equal(error.status, 400);
    assert.equal(String(error.message).includes("refresh-keep"), false);
    assert.equal(String(error.message).includes("client-secret-value"), false);
    return true;
  });
  assert.equal(storage.read("oauth2").refreshToken, "refresh-keep");
  assert.equal(storage.read("oauth2").accessToken, "old-access");
});

test("a proactive refresh that fails still returns an unexpired access token", async () => {
  const storage = memory();
  await storage.put("oauth2", {
    accessToken: "still-good",
    refreshToken: "refresh-keep",
    expiresAt: NOW + 10 * 60 * 1000,
  });
  const keeper = createTokenKeeper({
    storage,
    env: env({ X_OAUTH2_REFRESH_TOKEN: "refresh-keep" }),
    now: () => NOW,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(await keeper.accessToken(), "still-good");
  assert.equal(storage.read("oauth2").refreshToken, "refresh-keep");
});

test("a different secret refresh token is tried only after the stored one fails", async () => {
  const storage = memory();
  await storage.put("oauth2", { accessToken: "old-access", refreshToken: "stored-refresh", expiresAt: 0 });
  const used = [];
  const keeper = createTokenKeeper({
    storage,
    env: env({ X_OAUTH2_REFRESH_TOKEN: "replacement-refresh" }),
    now: () => NOW,
    fetchImpl: async (_url, opts) => {
      const refresh = new URLSearchParams(opts.body).get("refresh_token");
      used.push(refresh);
      if (refresh === "stored-refresh") return { ok: false, status: 400, json: async () => ({}) };
      return tokenResponse("access-3", "refresh-3");
    },
  });
  assert.equal(await keeper.accessToken(), "access-3");
  assert.deepEqual(used, ["stored-refresh", "replacement-refresh"]);
  assert.equal(storage.read("oauth2").refreshToken, "refresh-3");
});

test("a 401 forces one refresh and a second force for the old access token does not rotate again", async () => {
  const storage = memory();
  await storage.put("oauth2", {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: NOW + 2 * 60 * 60 * 1000,
  });
  let calls = 0;
  const keeper = createTokenKeeper({
    storage,
    env: env(),
    now: () => NOW,
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse("access-2", "refresh-2");
    },
  });
  assert.equal(await keeper.accessToken({ force: true, unacceptable: "access-1" }), "access-2");
  assert.equal(await keeper.accessToken({ force: true, unacceptable: "access-1" }), "access-2");
  assert.equal(calls, 1);
});

test("the warm cron logs status only", async () => {
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  try {
    await warmScheduled({}, {
      accessToken: async () => "access-secret-value",
    });
    await warmScheduled({}, {
      accessToken: async () => {
        const error = new Error("boom access-secret-value");
        error.status = 503;
        throw error;
      },
    });
  } finally {
    console.log = original;
  }
  const text = logs.join("\n");
  assert.match(text, /x\.oauth\.warm/);
  assert.match(text, /"ok":true/);
  assert.match(text, /"status":503/);
  assert.equal(text.includes("access-secret-value"), false);
});

test("wrangler publishes the client id and a 30 minute cron, and the readme names the refresh secret", () => {
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, new RegExp('"X_CLIENT_ID": "' + CLIENT_ID + '"'));
  assert.match(wrangler, /"\*\/30 \* \* \* \*"/);
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const section = readme.split("## X replies")[1]?.split("\n## ")[0] || "";
  assert.match(section, /X_OAUTH2_REFRESH_TOKEN/);
  assert.match(section, /X_CLIENT_ID/);
  assert.equal(section.includes("\u2014"), false);
  const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(index, /scheduled/);
  assert.match(index, /waitUntil/);
});
