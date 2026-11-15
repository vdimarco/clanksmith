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
        json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "I'll do it for $50." } }] }),
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

test("a drafted reply and an encrypted chat each wake the chat once", async () => {
  const inbox = createMemoryInbox();
  const notices = [];
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  const wake = {
    X_REPLY_MODE: "dry-run",
    CHAT_WAKE_URL: "https://wake.example/hook",
    CHAT_WAKE_AUTH: "Bearer wake-secret-value",
  };
  const notifyFetch = async (_url, opts) => {
    notices.push(JSON.parse(opts.body));
    return { status: 202 };
  };
  const mention = {
    data: {
      event_type: "post.mention.create",
      filter: { user_id: "1065743939729309697" },
      payload: { id: "9001", author_id: "42", text: "hey @clanksmith" },
      includes: { users: [{ id: "42", username: "proto_von" }] },
    },
  };
  try {
    await handleX(postRequest(mention), env(wake), { inbox, notifyFetch });
    await handleX(postRequest(mention), env(wake), { inbox, notifyFetch });
    await handleX(postRequest({
      data: {
        event_type: "chat.received",
        filter: { user_id: "1065743939729309697" },
        payload: { id: "chat-9", sender_id: "8", conversation_id: "8:1065743939729309697", encoded_event: "ciphertext" },
      },
    }), env(wake), { inbox, notifyFetch });
    await handleX(postRequest({
      data: {
        event_type: "post.mention.create",
        filter: { user_id: "1065743939729309697" },
        payload: { id: "9002", author_id: "9", text: "Huge giveaway, follow me for a referral airdrop" },
      },
    }), env(wake), { inbox, notifyFetch });
    await handleX(postRequest({
      data: {
        event_type: "post.mention.create",
        filter: { user_id: "1065743939729309697" },
        payload: { id: "9003", author_id: "1065743939729309697", text: "hello" },
      },
    }), env(wake), { inbox, notifyFetch });
  } finally {
    console.log = original;
  }
  assert.equal(notices.length, 2);
  assert.equal(notices[0].type, "reply");
  assert.equal(notices[0].kind, "post");
  assert.equal(notices[0].id, "9001");
  assert.equal(notices[0].author, "@proto_von");
  assert.equal(notices[0].author_id, "42");
  assert.equal(notices[0].their_text, "hey @clanksmith");
  assert.equal(notices[0].reply_text, REPLIES.default);
  assert.equal(notices[0].source, "template");
  assert.equal(notices[0].outcome, "dry-run");
  assert.equal(notices[0].reason, "default");
  assert.equal(notices[1].type, "chat");
  assert.equal(notices[1].event_id, "chat-9");
  assert.equal(notices[1].sender_id, "8");
  assert.equal(notices[1].conversation_id, "8:1065743939729309697");
  assert.ok((await inbox.reviews()).some((item) => item.id === "chat-9" && item.reason === "encrypted"));
  const logged = logs.join("\n");
  assert.equal(logged.includes("wake-secret-value"), false);
  assert.equal(logged.includes("https://wake.example/hook"), false);
  assert.equal(logged.includes("ciphertext"), false);
});

test("the webhook returns 200 before the model finishes, and a retry does not post twice", async () => {
  const inbox = createMemoryInbox();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const jobs = [];
  const ctx = { waitUntil(promise) { jobs.push(promise); } };
  let calls = 0;
  let responded = false;
  const responsePromise = handleX(postRequest(question), env({
    X_BOT_USERNAME: "clanksmith",
    X_OAUTH2_USER_TOKEN: "user-token-value",
    HERMES_API_KEY: "hermes-test-key",
  }), {
    inbox,
    ctx,
    llmFetch: async () => {
      await gate;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "Hey. What do you want done? https://clanksmith.com" } }] }),
      };
    },
    fetchImpl: async () => {
      calls += 1;
      return { ok: calls === 1 ? false : true, status: calls === 1 ? 503 : 200, json: async () => ({ data: { id: "1" } }) };
    },
    now: () => Date.parse("2026-11-15T05:00:00.000Z"),
  });
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
  responded = true;
  release();
  await Promise.all(jobs);
  assert.equal(responded, true);
  assert.equal(calls, 2);
  const again = await handleX(postRequest(question), env({
    X_BOT_USERNAME: "clanksmith",
    X_OAUTH2_USER_TOKEN: "user-token-value",
  }), {
    inbox,
    ctx,
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ data: { id: "2" } }) }; },
    now: () => Date.parse("2026-11-15T05:00:01.000Z"),
  });
  await Promise.all(jobs);
  assert.equal(again.status, 200);
  assert.equal(calls, 2);
});

const BOUNTY = "Aktionariat's contract bounty pays 3 ETH for high-impact bugs (takeover or drain of a token, market or payment hub) and 1 ETH for medium. Email bugs@aktionariat.com with a Hardhat PoC against master. github.com/aktionariat/contracts";
const WARM = "This one is already spelled out. Aktionariat pays 3 ETH for a high-impact bug and 1 ETH for a medium one. Email a Hardhat PoC against master to bugs@aktionariat.com.";

function aktionariat(mentionId) {
  return {
    data: {
      event_type: "post.mention.create",
      filter: { user_id: "1065743939729309697" },
      payload: {
        id: mentionId,
        author_id: "15320730",
        text: "@W3B_AI_SR @clanksmith check out the above",
        referenced_tweets: [{ type: "replied_to", id: "2121989097954697556" }],
      },
      includes: {
        users: [
          { id: "15320730", username: "proto_von" },
          { id: "1934994668359413760", username: "W3B_AI_SR" },
        ],
        tweets: [{ id: "2121989097954697556", author_id: "1934994668359413760", text: BOUNTY }],
      },
    },
  };
}

function logged(lines) {
  return lines.map((entry) => { try { return JSON.parse(entry); } catch { return null; } }).filter(Boolean);
}

test("a pointer at the Aktionariat post uses its ETH budget and does not lecture", async () => {
  const inbox = createMemoryInbox();
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  let llm = 0;
  let posted = 0;
  try {
    const response = await handleX(postRequest(aktionariat("2122006059141263643")), env({
      X_REPLY_MODE: "dry-run",
      X_BOT_USERNAME: "clanksmith",
      HERMES_API_KEY: "hermes-test-key",
    }), {
      inbox,
      llmFetch: async () => { llm += 1; throw new Error("model"); },
      fetchImpl: async () => { posted += 1; throw new Error("sent"); },
      now: () => Date.parse("2026-11-15T16:40:00.000Z"),
    });
    assert.equal(response.status, 200);
  } finally {
    console.log = original;
  }
  assert.equal(llm, 0);
  assert.equal(posted, 0);
  const reply = logged(logs).find((entry) => entry.event === "x.reply");
  assert.equal(reply.text, WARM);
  assert.equal(reply.source, "brief");
  assert.equal(reply.text.includes("\u2014"), false);
  assert.equal(/still just a request|what budget|what deadline/i.test(reply.text), false);
});

test("a pointer with no included parent is read from X before the reply", async () => {
  const inbox = createMemoryInbox();
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  const token = "bearer-read-token";
  const payload = {
    data: {
      event_type: "post.mention.create",
      filter: { user_id: "1065743939729309697" },
      payload: {
        id: "2122006059141263700",
        author_id: "15320730",
        text: "@W3B_AI_SR @clanksmith check out the above",
        referenced_tweets: [{ type: "replied_to", id: "2121989097954697556" }],
      },
      includes: { users: [{ id: "15320730", username: "proto_von" }] },
    },
  };
  let saw = "";
  try {
    await handleX(postRequest(payload), env({
      X_REPLY_MODE: "dry-run",
      X_BEARER_TOKEN: token,
      X_BOT_USERNAME: "clanksmith",
    }), {
      inbox,
      fetchImpl: async (url, opts) => {
        saw = url;
        assert.equal(opts.headers.authorization, "Bearer " + token);
        return {
          ok: true,
          json: async () => ({
            data: { id: "2121989097954697556", text: BOUNTY, author_id: "1934994668359413760" },
            includes: { users: [{ id: "1934994668359413760", username: "W3B_AI_SR" }] },
          }),
        };
      },
      now: () => Date.parse("2026-11-15T16:43:00.000Z"),
    });
  } finally {
    console.log = original;
  }
  assert.match(saw, /2121989097954697556/);
  const reply = logged(logs).find((entry) => entry.event === "x.reply");
  assert.equal(reply.text, WARM);
  assert.equal(JSON.stringify(logs).includes(token), false);
});

test("dry-run listings record one market job for the source post and link it", async () => {
  const inbox = createMemoryInbox();
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  try {
    await handleX(postRequest(aktionariat("2122006059141263643")), env({
      X_REPLY_MODE: "dry-run",
      X_MARKET_LISTINGS: "dry-run",
      X_BOT_USERNAME: "clanksmith",
    }), {
      inbox,
      fetchImpl: async () => { throw new Error("sent"); },
      now: () => Date.parse("2026-11-15T16:40:00.000Z"),
    });
    await handleX(postRequest(aktionariat("2122006059141263644")), env({
      X_REPLY_MODE: "dry-run",
      X_MARKET_LISTINGS: "dry-run",
      X_BOT_USERNAME: "clanksmith",
    }), {
      inbox,
      fetchImpl: async () => { throw new Error("sent"); },
      now: () => Date.parse("2026-11-15T16:41:00.000Z"),
    });
  } finally {
    console.log = original;
  }
  const rows = logged(logs);
  const listings = rows.filter((entry) => entry.event === "x.listing");
  const replies = rows.filter((entry) => entry.event === "x.reply");
  assert.equal(listings.length, 2);
  assert.equal(listings[0].replayed, false);
  assert.equal(listings[1].replayed, true);
  assert.equal(listings[0].sourcePostId, "2121989097954697556");
  assert.equal(listings[0].payer, "Aktionariat");
  assert.equal(listings[0].payerKind, "third-party");
  assert.deepEqual(listings[0].amounts, ["3 ETH", "1 ETH"]);
  assert.equal(listings[0].dryRun, true);
  assert.equal(listings[0].sent, false);
  assert.equal(listings[0].jobId, "dry-run-2121989097954697556");
  const url = "https://market.near.ai/jobs/dry-run-2121989097954697556";
  assert.equal(replies[0].text, WARM + " Agents can bid here: " + url);
  assert.equal(replies[1].text, replies[0].text);
  assert.equal(replies[0].text.length <= 280, true);
  assert.equal(JSON.stringify(rows).includes("proto_von"), false);
});

test("live listing mode does not escrow a third-party ETH bounty", async () => {
  const inbox = createMemoryInbox();
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  let posted = 0;
  try {
    await handleX(postRequest(aktionariat("2122006059141263999")), env({
      X_REPLY_MODE: "dry-run",
      X_MARKET_LISTINGS: "live",
      AGENT_MARKET_BUYER_KEY: "buyer-secret",
      X_BOT_USERNAME: "clanksmith",
    }), {
      inbox,
      fetchImpl: async () => { posted += 1; throw new Error("sent"); },
      now: () => Date.parse("2026-11-15T16:42:00.000Z"),
    });
  } finally {
    console.log = original;
  }
  assert.equal(posted, 0);
  const rows = logged(logs);
  const listing = rows.find((entry) => entry.event === "x.listing");
  const reply = rows.find((entry) => entry.event === "x.reply");
  assert.equal(listing.reason, "external-bounty-not-escrowed");
  assert.equal(listing.sent, false);
  assert.equal(listing.url, "");
  assert.equal(reply.text, WARM);
  assert.equal(reply.text.includes("market.near.ai"), false);
  assert.equal(JSON.stringify(rows).includes("buyer-secret"), false);
});
