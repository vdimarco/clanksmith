import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWebhook } from "./events.mjs";

const BOT = "1065743939729309697";

test("an X Activity mention and a direct reply become post events", () => {
  const mention = normalizeWebhook({
    data: {
      event_uuid: "9001",
      event_type: "post.mention.create",
      filter: { user_id: BOT },
      payload: { id: "555", author_id: "42", text: "what is @clanksmith?" },
    },
  }, BOT);
  assert.deepEqual(mention, [{
    kind: "post",
    id: "555",
    authorId: "42",
    text: "what is @clanksmith?",
    isRetweet: false,
    isQuote: false,
    username: "",
    parentText: "",
    encrypted: false,
    eventType: "post.mention.create",
    participantId: null,
  }]);

  const reply = normalizeWebhook({
    data: {
      event_type: "post.reply.create",
      filter: { user_id: BOT },
      payload: {
        id: "556",
        author_id: "42",
        text: "@clanksmith how do agents bid?",
        referenced_tweets: [{ type: "replied_to", id: "1" }],
      },
    },
  }, BOT);
  assert.equal(reply[0].id, "556");
  assert.equal(reply[0].isRetweet, false);
  assert.equal(reply[0].eventType, "post.reply.create");

  const withParent = normalizeWebhook({
    data: {
      event_type: "post.reply.create",
      filter: { user_id: BOT },
      payload: { id: "2", author_id: "42", text: "hey", in_reply_to_tweet_id: "1" },
      includes: {
        users: [{ id: "42", username: "proto_von" }],
        tweets: [{ id: "1", text: "Need a logo that still reads at night" }],
      },
    },
  }, BOT);
  assert.equal(withParent[0].username, "proto_von");
  assert.equal(withParent[0].parentText, "Need a logo that still reads at night");
});

test("reposts, legacy retweets, plaintext DMs, and encrypted chats are distinguished", () => {
  const repost = normalizeWebhook({
    data: {
      event_type: "post.repost.create",
      filter: { user_id: BOT },
      payload: { id: "7", author_id: "8", text: "RT @clanksmith hello" },
    },
  }, BOT);
  assert.equal(repost[0].isRetweet, true);

  const legacy = normalizeWebhook({
    for_user_id: BOT,
    tweet_create_events: [{
      id_str: "77",
      text: "RT @clanksmith what is this",
      user: { id_str: "8" },
      retweeted_status: { id_str: "1" },
    }],
    direct_message_events: [{
      type: "message_create",
      id: "88",
      message_create: {
        sender_id: "8",
        target: { recipient_id: BOT },
        message_data: { text: "how do I post a job?" },
      },
    }],
  }, BOT);
  assert.equal(legacy[0].kind, "post");
  assert.equal(legacy[0].isRetweet, true);
  assert.equal(legacy[0].id, "77");
  assert.equal(legacy[1].kind, "dm");
  assert.equal(legacy[1].id, "88");
  assert.equal(legacy[1].text, "how do I post a job?");
  assert.equal(legacy[1].participantId, "8");

  const chat = normalizeWebhook({
    data: {
      event_type: "chat.received",
      filter: { user_id: BOT },
      payload: { id: "chat-9", sender_id: "8", encoded_event: "ciphertext" },
    },
  }, BOT);
  assert.equal(chat[0].kind, "chat");
  assert.equal(chat[0].encrypted, true);
  assert.equal(chat[0].text, "");
  assert.equal(JSON.stringify(chat).includes("ciphertext"), false);
});

test("events for a different account are dropped", () => {
  const events = normalizeWebhook({
    data: {
      event_type: "post.mention.create",
      filter: { user_id: "1" },
      payload: { id: "5", author_id: "2", text: "what is clanksmith?" },
    },
  }, BOT);
  assert.deepEqual(events, []);
});
