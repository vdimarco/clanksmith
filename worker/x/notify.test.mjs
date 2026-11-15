import assert from "node:assert/strict";
import test from "node:test";
import { chatNotice, postNotify, replyNotice } from "./notify.mjs";

const URL = "https://wake.example/hook";
const AUTH = "Bearer super-secret-wake-token";

test("a drafted reply notice names the post, the author, and the text", () => {
  const notice = replyNotice({
    event: { kind: "post", id: "9001", authorId: "42", username: "proto_von", text: "hey @clanksmith" },
    composed: { text: "Hey. What do you want done?", source: "llm", model: "x-ai/grok-4.3" },
    outcome: "dry-run",
    reason: "default",
  });
  assert.deepEqual(notice, {
    type: "reply",
    kind: "post",
    id: "9001",
    author: "@proto_von",
    author_id: "42",
    their_text: "hey @clanksmith",
    reply_text: "Hey. What do you want done?",
    source: "grok",
    model: "x-ai/grok-4.3",
    outcome: "dry-run",
    reason: "default",
  });
  assert.equal(replyNotice({
    event: { kind: "dm", id: "dm-1", authorId: "7", text: "refund" },
    outcome: "held",
    reason: "refund",
  }).source, "template");
});

test("an encrypted chat notice carries the conversation and the sender", () => {
  assert.deepEqual(chatNotice({
    id: "chat-9",
    authorId: "8",
    participantId: "8",
    conversationId: "8:1065743939729309697",
  }), {
    type: "chat",
    sender_id: "8",
    event_id: "chat-9",
    conversation_id: "8:1065743939729309697",
  });
});

test("missing secrets do not call the webhook", async () => {
  let calls = 0;
  await postNotify({ CHAT_WAKE_URL: URL }, { type: "chat" }, { fetchImpl: async () => { calls += 1; } });
  await postNotify({ CHAT_WAKE_AUTH: AUTH }, { type: "chat" }, { fetchImpl: async () => { calls += 1; } });
  await postNotify({}, { type: "chat" }, { fetchImpl: async () => { calls += 1; } });
  assert.equal(calls, 0);
});

test("a wake post sends the auth header verbatim and logs only the status", async () => {
  let seen = null;
  const logs = [];
  const original = console.log;
  console.log = (...parts) => logs.push(parts.join(" "));
  try {
    await postNotify({ CHAT_WAKE_URL: URL, CHAT_WAKE_AUTH: AUTH }, { type: "chat", event_id: "1" }, {
      fetchImpl: async (url, opts) => {
        seen = { url, opts };
        return { status: 204 };
      },
    });
  } finally {
    console.log = original;
  }
  assert.equal(seen.url, URL);
  assert.equal(seen.opts.headers.authorization, AUTH);
  assert.equal(seen.opts.headers["content-type"], "application/json");
  assert.equal(JSON.parse(seen.opts.body).type, "chat");
  const logged = logs.join("\n");
  assert.match(logged, /"status":204/);
  assert.equal(logged.includes(URL), false);
  assert.equal(logged.includes(AUTH), false);
  assert.equal(logged.includes("super-secret-wake-token"), false);
});
