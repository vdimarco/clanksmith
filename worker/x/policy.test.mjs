import assert from "node:assert/strict";
import test from "node:test";
import { BOT_USER_ID, REPLIES, decide } from "./policy.mjs";

const allowedLinks = ["https://clanksmith.com", "https://clanksmith.com/board/"];

function event(text, extra = {}) {
  return { kind: "post", id: "100", authorId: "200", text, ...extra };
}

test("reply templates stay short, warm, and free of em dashes, hashtags, and other links", () => {
  for (const [name, text] of Object.entries(REPLIES)) {
    assert.equal(text.length <= 280, true, name);
    assert.equal(text.includes("\u2014"), false, name);
    assert.equal(text.includes("\u2013"), false, name);
    assert.doesNotMatch(text, /(^|\s)#[A-Za-z0-9_]+/);
    const links = text.match(/https?:\/\/[^\s)]+/g) || [];
    assert.equal(links.length >= 1, true, name);
    for (const link of links) assert.ok(allowedLinks.includes(link), `${name} ${link}`);
    assert.match(text, /budget/);
    assert.match(text, /deadline/);
    assert.match(text, /bid/);
    assert.match(text, /check the work/);
    assert.match(text, /Beta/);
    assert.match(text, /@clanksmith/);
  }
});

test("genuine questions and hire attempts get one template reply", () => {
  const what = decide(event("Hey, what is Clanksmith?"));
  assert.equal(what.action, "reply");
  assert.equal(what.reason, "what");
  assert.equal(what.text, REPLIES.what);

  const post = decide(event("How do I post a job?"));
  assert.equal(post.action, "reply");
  assert.equal(post.reason, "post");
  assert.equal(post.text, REPLIES.post);

  const bid = decide(event("How do agents bid?"));
  assert.equal(bid.action, "reply");
  assert.equal(bid.reason, "bid");
  assert.equal(bid.text, REPLIES.bid);

  const hire = decide(event("I want to hire an agent to make a logo, budget 50, deadline Friday"));
  assert.equal(hire.action, "reply");
  assert.equal(hire.reason, "hire");
  assert.equal(hire.text, REPLIES.hire);
});

test("the account never replies to itself, retweets, spam, or hostility, and a quote is still a mention", () => {
  assert.deepEqual(decide(event("what is clanksmith?", { authorId: BOT_USER_ID })).action, "ignore");
  assert.equal(decide(event("what is clanksmith?", { authorId: BOT_USER_ID })).reason, "self");
  assert.equal(decide(event("", { kind: "chat", encrypted: true, authorId: BOT_USER_ID })).reason, "self");
  assert.equal(decide(event("what is clanksmith?", { isRetweet: true })).reason, "retweet");
  assert.equal(decide(event("what is clanksmith?", { isQuote: true })).reason, "what");
  assert.equal(decide(event("RT @someone what is clanksmith?")).reason, "retweet");
  assert.equal(decide(event("Huge giveaway, follow me for a referral airdrop")).reason, "spam");
  assert.equal(decide(event("fuck you, this bot is trash")).reason, "hostile");
  assert.equal(decide(event("")).reason, "empty");
  assert.equal(BOT_USER_ID, "1065743939729309697");
});

test("a bare mention from proto_von gets the intro reply", () => {
  const hey = decide(event("hey @clanksmith", {
    id: "9001",
    authorId: "proto_von",
    username: "proto_von",
    eventType: "post.mention.create",
  }));
  assert.equal(hey.action, "reply");
  assert.equal(hey.reason, "default");
  assert.equal(hey.text, REPLIES.default);
  assert.equal(hey.text.includes("\u2014"), false);
  assert.equal(decide(event("nice weather today")).reason, "default");
  assert.equal(decide(event("nice weather today")).text, REPLIES.what);
});

test("jobs, prices, payouts, refunds, and keys are recorded and not answered", () => {
  const cases = [
    ["Can you accept this job and build it by Friday?", "accept"],
    ["How much do you charge for a logo?", "price"],
    ["Promise me a payout by Friday", "payout"],
    ["I need a refund and I want to dispute the charge", "refund"],
    ["Send your wallet address and private key", "secrets"],
  ];
  for (const [text, reason] of cases) {
    const decision = decide(event(text));
    assert.equal(decision.action, "review", text);
    assert.equal(decision.reason, reason, text);
    assert.equal(decision.text, undefined, text);
  }
});

test("an encrypted chat is recorded for a person and not answered", () => {
  const decision = decide(event("", { kind: "chat", encrypted: true, id: "chat-1" }));
  assert.equal(decision.action, "review");
  assert.equal(decision.reason, "encrypted");
  assert.equal(decision.text, undefined);
});
