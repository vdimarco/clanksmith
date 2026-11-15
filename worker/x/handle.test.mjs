import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createMemoryInbox } from "./inbox.mjs";
import { handleX, replyMode } from "./handle.mjs";
import { REPLIES } from "./policy.mjs";

const SECRET = "consumer-secret-value";
const REVIEW = "review-token-value";

function sign(raw) {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("base64");
}

function env(extra = {}) {
  return { X_API_SECRET: SECRET, X_REVIEW_TOKEN: REVIEW, X_REPLY_MODE: "live", ...extra };
}

function postRequest(payload, { signature } = {}) {
  const raw = JSON.stringify(payload);
  return new Request("https://clanksmith.com/x/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-twitter-webhooks-signature": signature === undefined ? sign(raw) : signature,
    },
    body: raw,
  });
}

const question = {
  data: {
    event_type: "post.mention.create",
    filter: { user_id: "1065743939729309697" },
    payload: { id: "555", author_id: "42", text: "what is Clanksmith?" },
  },
};

test("reply mode defaults to off and only live or dry-run are special", () => {
  assert.equal(replyMode({}), "off");
  assert.equal(replyMode({ X_REPLY_MODE: "LIVE" }), "live");
  assert.equal(replyMode({ X_REPLY_MODE: "dry-run" }), "dry-run");
  assert.equal(replyMode({ X_REPLY_MODE: "yes" }), "off");
});

test("CRC answers with the consumer secret and rejects a missing challenge", async () => {
  const inbox = createMemoryInbox();
  const ok = await handleX(new Request("https://clanksmith.com/x/webhook?crc_token=abc123"), env(), { inbox });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.response_token, sign("abc123"));

  const missing = await handleX(new Request("https://clanksmith.com/x/webhook"), env(), { inbox });
  assert.equal(missing.status, 400);
});

test("an unsigned or badly signed POST is rejected and does not reach the inbox", async () => {
  const inbox = createMemoryInbox();
  let claims = 0;
  const wrapped = {
    claim: async (...args) => { claims += 1; return inbox.claim(...args); },
    release: (id) => inbox.release(id),
    remember: (item) => inbox.remember(item),
    review: (item) => inbox.review(item),
    reviews: () => inbox.reviews(),
  };
  const unsigned = postRequest(question, { signature: "" });
  const denied = await handleX(unsigned, env(), { inbox: wrapped, fetchImpl: async () => { throw new Error("sent"); } });
  assert.equal(denied.status, 401);
  const raw = JSON.stringify(question);
  const bad = postRequest(question, { signature: sign(raw + " ") });
  const also = await handleX(bad, env(), { inbox: wrapped });
  assert.equal(also.status, 401);
  assert.equal(claims, 0);
});

test("dry-run logs the reply it would send and does not call X", async () => {
  const inbox = createMemoryInbox();
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  let called = 0;
  try {
    const response = await handleX(postRequest(question), env({ X_REPLY_MODE: "dry-run" }), {
      inbox,
      fetchImpl: async () => { called += 1; throw new Error("sent"); },
      now: () => Date.parse("2026-11-15T03:00:00.000Z"),
    });
    assert.equal(response.status, 200);
  } finally {
    console.log = original;
  }
  assert.equal(called, 0);
  assert.match(logs.join("\n"), /dry-run/);
  assert.match(logs.join("\n"), /https:\/\/clanksmith\.com/);
  const again = await handleX(postRequest(question), env({ X_REPLY_MODE: "dry-run" }), {
    inbox,
    fetchImpl: async () => { called += 1; throw new Error("sent"); },
    now: () => Date.parse("2026-11-15T03:00:01.000Z"),
  });
  assert.equal(again.status, 200);
  assert.equal(called, 0);
});

test("a bare hey mention from proto_von is replied to with the intro", async () => {
  const inbox = createMemoryInbox();
  const sent = [];
  const mention = {
    data: {
      event_type: "post.mention.create",
      filter: { user_id: "1065743939729309697" },
      payload: { id: "9001", author_id: "proto_von", text: "hey @clanksmith" },
    },
  };
  const response = await handleX(postRequest(mention), env({
    X_BOT_USERNAME: "clanksmith",
    X_OAUTH2_USER_TOKEN: "user-token-value",
  }), {
    inbox,
    fetchImpl: async (_url, opts) => {
      sent.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ data: { id: "9002" } }) };
    },
    now: () => Date.parse("2026-11-15T04:30:00.000Z"),
  });
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, REPLIES.default);
  assert.equal(sent[0].reply.in_reply_to_tweet_id, "9001");
  assert.equal(sent[0].text.includes("\u2014"), false);
});

test("a rejected model reply logs fallback reasons and does not send them", async () => {
  const inbox = createMemoryInbox();
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  let posted = 0;
  try {
    await handleX(postRequest(question), env({
      X_REPLY_MODE: "dry-run",
      HERMES_API_KEY: "hermes-test-key",
    }), {
      inbox,
      llmFetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "I'll do it for $50." } }] }),
      }),
      fetchImpl: async () => { posted += 1; throw new Error("sent"); },
      now: () => Date.parse("2026-11-15T06:00:00.000Z"),
    });
  } finally {
    console.log = original;
  }
  assert.equal(posted, 0);
  const line = logs.map((entry) => { try { return JSON.parse(entry); } catch { return null; } }).find((entry) => entry && entry.event === "x.reply");
  assert.equal(line.source, "template");
  assert.ok(line.fallback.includes("price"));
  assert.ok(line.fallback.includes("accept"));
  assert.equal(JSON.stringify(line).includes("hermes-test-key"), false);
});

test("live mode posts once, ignores the bot's own user id, and keeps refunds for review", async () => {
  const inbox = createMemoryInbox();
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push({ url, body: opts.body, authorization: opts.headers.authorization });
    return { ok: true, json: async () => ({ data: { id: "777" } }) };
  };
  const credentials = {
    X_BOT_USERNAME: "clanksmith",
    X_API_KEY: "ck",
    X_API_SECRET: SECRET,
    X_ACCESS_TOKEN: "tk",
    X_ACCESS_TOKEN_SECRET: "token-secret-value",
    X_OAUTH2_USER_TOKEN: "user-token-value",
  };
  const first = await handleX(postRequest(question), env(credentials), {
    inbox,
    fetchImpl,
    now: () => Date.parse("2026-11-15T04:00:00.000Z"),
    nonce: "n1",
    timestamp: 1700000000,
  });
  assert.equal(first.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].body).reply.in_reply_to_tweet_id, "555");
  assert.equal(sent[0].authorization.includes("user-token-value"), true);
  assert.equal(JSON.stringify(sent).includes("token-secret-value"), false);

  const second = await handleX(postRequest(question), env(credentials), {
    inbox,
    fetchImpl,
    now: () => Date.parse("2026-11-15T04:00:01.000Z"),
  });
  assert.equal(second.status, 200);
  assert.equal(sent.length, 1);

  const self = {
    data: {
      event_type: "post.mention.create",
      filter: { user_id: "1065743939729309697" },
      payload: { id: "556", author_id: "1065743939729309697", text: "what is Clanksmith?" },
    },
  };
  await handleX(postRequest(self), env(credentials), { inbox, fetchImpl, now: () => Date.parse("2026-11-15T04:00:02.000Z") });
  assert.equal(sent.length, 1);

  const refund = {
    data: {
      event_type: "dm.received",
      filter: { user_id: "1065743939729309697" },
      payload: {
        direct_message_events: [{
          id: "dm-1",
          message_create: {
            sender_id: "42",
            target: { recipient_id: "1065743939729309697" },
            message_data: { text: "please refund, seed phrase abandon abandon" },
          },
        }],
      },
    },
  };
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  try {
    await handleX(postRequest(refund), env(credentials), { inbox, fetchImpl, now: () => Date.parse("2026-11-15T04:00:03.000Z") });
  } finally {
    console.log = original;
  }
  assert.equal(sent.length, 1);
  assert.equal(logs.join("\n").includes("abandon"), false);
  const review = await handleX(new Request("https://clanksmith.com/x/review", {
    headers: { authorization: "Bearer " + REVIEW },
  }), env(credentials), { inbox });
  assert.equal(review.status, 200);
  const items = (await review.json()).items;
  assert.equal(items.some((item) => item.reason === "refund" && item.text.includes("abandon")), true);

  const locked = await handleX(new Request("https://clanksmith.com/x/review"), env(credentials), { inbox });
  assert.equal(locked.status, 401);
});

test("off mode acknowledges a signed event and sends nothing", async () => {
  const inbox = createMemoryInbox();
  let called = 0;
  const response = await handleX(postRequest(question), env({ X_REPLY_MODE: "off" }), {
    inbox,
    fetchImpl: async () => { called += 1; throw new Error("sent"); },
  });
  assert.equal(response.status, 200);
  assert.equal(called, 0);
  assert.equal((await inbox.reviews()).length, 0);
});

test("a failed live send releases the claim so a retry can post", async () => {
  const inbox = createMemoryInbox();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, json: async () => ({ error: "nope" }) };
    return { ok: true, json: async () => ({ data: { id: "1" } }) };
  };
  const credentials = {
    X_BOT_USERNAME: "clanksmith",
    X_OAUTH2_USER_TOKEN: "user-token-value",
    X_API_SECRET: SECRET,
  };
  const first = await handleX(postRequest(question), env(credentials), {
    inbox,
    fetchImpl,
    now: () => Date.parse("2026-11-15T05:00:00.000Z"),
  });
  assert.equal(first.status, 503);
  const second = await handleX(postRequest(question), env(credentials), {
    inbox,
    fetchImpl,
    now: () => Date.parse("2026-11-15T05:00:01.000Z"),
  });
  assert.equal(second.status, 200);
  assert.equal(calls, 2);
});
