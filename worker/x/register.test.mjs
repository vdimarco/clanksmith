import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BOT_USER_ID, SUBSCRIPTIONS, WEBHOOK_URL, registerWebhooks } from "./register.mjs";

test("registration targets the apex webhook and the mention, reply, and DM subscriptions", async () => {
  assert.equal(WEBHOOK_URL, "https://clanksmith.com/x/webhook");
  assert.equal(BOT_USER_ID, "1065743939729309697");
  assert.deepEqual(SUBSCRIPTIONS, ["post.mention.create", "post.reply.create", "dm.received", "chat.received"]);

  const calls = [];
  const token = "bearer-token-value";
  const user = "oauth-user-token-value";
  const summary = await registerWebhooks({
    env: { X_BEARER_TOKEN: token, X_OAUTH2_USER_TOKEN: user },
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith("/2/webhooks") && opts.method === "POST") {
        return { ok: true, json: async () => ({ data: { id: "wh1", url: WEBHOOK_URL, valid: true } }) };
      }
      return { ok: true, json: async () => ({ data: { id: "sub-" + calls.length } }) };
    },
  });

  assert.equal(calls[0].url, "https://api.x.com/2/webhooks");
  assert.equal(calls[0].opts.headers.authorization, "Bearer " + token);
  assert.equal(JSON.parse(calls[0].opts.body).url, WEBHOOK_URL);
  assert.equal(calls.length, 1 + SUBSCRIPTIONS.length);
  for (const [index, eventType] of SUBSCRIPTIONS.entries()) {
    const call = calls[index + 1];
    const body = JSON.parse(call.opts.body);
    assert.equal(call.url, "https://api.x.com/2/activity/subscriptions");
    assert.equal(call.opts.headers.authorization, "Bearer " + user);
    assert.equal(body.event_type, eventType);
    assert.equal(body.filter.user_id, BOT_USER_ID);
    assert.equal(body.webhook_id, "wh1");
  }
  const encoded = JSON.stringify(summary);
  assert.equal(encoded.includes(token), false);
  assert.equal(encoded.includes(user), false);
  assert.equal(summary.webhookId, "wh1");
});

test("the readme names the secrets, the mode switch, and the paid tier, without em dashes", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const section = readme.split("## X replies")[1]?.split("\n## ")[0];
  assert.ok(section, "X replies section");
  assert.equal(section.includes("\u2014"), false);
  assert.equal(section.includes("\u2013"), false);
  for (const name of ["X_CLIENT_SECRET", "X_API_SECRET", "X_API_KEY", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET", "X_OAUTH2_USER_TOKEN", "X_OAUTH2_REFRESH_TOKEN", "X_CLIENT_ID", "X_BEARER_TOKEN", "X_REVIEW_TOKEN", "X_REPLY_MODE"]) {
    assert.match(section, new RegExp(name));
  }
  assert.match(section, /pay-per-use/);
  assert.match(section, /dry-run/);
  assert.match(section, /X Activity API/);
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.doesNotMatch(wrangler, /"X_REPLY_MODE"\s*:\s*"live"/);
  assert.match(wrangler, /XInbox/);
});

test("dry-run registration does not call X", async () => {
  let called = 0;
  const summary = await registerWebhooks({
    env: { X_BEARER_TOKEN: "bearer-token-value", X_OAUTH2_USER_TOKEN: "oauth-user-token-value" },
    dryRun: true,
    fetchImpl: async () => { called += 1; throw new Error("sent"); },
  });
  assert.equal(called, 0);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.subscriptions.length, SUBSCRIPTIONS.length);
});
