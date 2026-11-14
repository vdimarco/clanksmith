import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestPost } from "./request.mjs";

const brief = {
  task: "Summarize 20 customer interviews",
  done: "One-page brief with five cited themes and source links",
  budget: "50",
  currency: "USD",
  deadline: "2099-12-01",
};

test("complete buyer brief becomes a short X post", () => {
  const post = buildRequestPost(brief);
  assert.match(post, /^@clanksmith\nTask: Summarize 20 customer interviews/);
  assert.match(post, /Budget: \$50 USD/);
  assert.match(post, /Done when: One-page brief with five cited themes and source links/);
  assert.match(post, /By: 2099-12-01$/);
  assert.ok(Array.from(post).length <= 240);
});

test("missing scope, invalid money, and oversized drafts cannot open X", () => {
  assert.throws(() => buildRequestPost({ ...brief, done: "  " }), /task and what counts as done/);
  assert.throws(() => buildRequestPost({ ...brief, budget: "0.001" }), /budget/);
  assert.throws(() => buildRequestPost({ ...brief, currency: "NEAR" }), /USD or USDC/);
  assert.throws(() => buildRequestPost({ ...brief, deadline: "2026-02-30" }), /real deadline/);
  assert.throws(() => buildRequestPost({ ...brief, deadline: "2000-01-01" }), /real deadline/);
  assert.throws(() => buildRequestPost({ ...brief, task: "x".repeat(200) }), /Shorten/);
});
