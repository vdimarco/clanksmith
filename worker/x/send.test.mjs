import assert from "node:assert/strict";
import test from "node:test";
import { deliverReply } from "./send.mjs";

const oauth1 = {
  X_BOT_USERNAME: "clanksmith",
  X_API_KEY: "ck",
  X_API_SECRET: "consumer-secret-value",
  X_ACCESS_TOKEN: "tk",
  X_ACCESS_TOKEN_SECRET: "token-secret-value",
};

test("a live post uses OAuth 1.0a user context and does not echo secrets", async () => {
  let seen = null;
  const result = await deliverReply({
    kind: "post",
    text: "Hello from Clanksmith",
    replyTo: "555",
    env: oauth1,
    nonce: "n1",
    timestamp: 1700000000,
    fetchImpl: async (url, opts) => {
      seen = { url, opts };
      return { ok: true, json: async () => ({ data: { id: "999" } }) };
    },
  });
  const body = JSON.parse(seen.opts.body);
  assert.equal(seen.url, "https://api.x.com/2/tweets");
  assert.equal(body.text, "Hello from Clanksmith");
  assert.equal(body.reply.in_reply_to_tweet_id, "555");
  assert.equal(seen.opts.headers.authorization.startsWith("OAuth "), true);
  assert.equal(seen.opts.headers.authorization.includes("token-secret-value"), false);
  assert.equal(seen.opts.body.includes("token-secret-value"), false);
  assert.equal(result.id, "999");
});

test("an OAuth 2.0 user token is sent as a bearer and is not copied into the body", async () => {
  let seen = null;
  await deliverReply({
    kind: "dm",
    text: "Hello",
    participantId: "42",
    env: { ...oauth1, X_OAUTH2_USER_TOKEN: "user-token-value" },
    fetchImpl: async (url, opts) => {
      seen = { url, opts };
      return { ok: true, json: async () => ({ data: { dm_event_id: "dm1" } }) };
    },
  });
  assert.equal(seen.url, "https://api.x.com/2/dm_conversations/with/42/messages");
  assert.equal(seen.opts.headers.authorization, "Bearer user-token-value");
  assert.equal(seen.opts.body.includes("user-token-value"), false);
  assert.equal(JSON.parse(seen.opts.body).text, "Hello");
});

test("a non numeric reply target is refused before any request", async () => {
  let called = 0;
  await assert.rejects(() => deliverReply({
    kind: "post",
    text: "Hi",
    replyTo: "not-an-id",
    env: oauth1,
    fetchImpl: async () => { called += 1; return { ok: true, json: async () => ({}) }; },
  }), /id/);
  assert.equal(called, 0);
});

test("posting as proto_von is refused", async () => {
  await assert.rejects(() => deliverReply({
    kind: "post",
    text: "Hi",
    replyTo: "1",
    env: { ...oauth1, X_BOT_USERNAME: "proto_von" },
    fetchImpl: async () => { throw new Error("should not send"); },
  }), /proto_von/);
});
