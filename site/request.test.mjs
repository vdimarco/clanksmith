import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRequestPost } from "./request.mjs";
import { resolveFinish } from "../relay/finish.mjs";

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
  assert.match(post, /Finish: speed, score >= 80/);
  assert.match(post, /By: 2099-12-01$/);
  assert.ok(Array.from(post).length <= 240);
  const finish = resolveFinish({ description: post });
  assert.equal(finish.mode, "speed");
  assert.equal(finish.metric, "score");
  assert.equal(finish.target, 80);
});

test("a quality work order names the metric, direction, deadline, and budget", () => {
  const post = buildRequestPost({ ...brief, mode: "quality", metric: "latency", direction: "lower" });
  assert.match(post, /Finish: quality, latency lower/);
  assert.ok(Array.from(post).length <= 240);
  const finish = resolveFinish({ description: post });
  assert.equal(finish.mode, "quality");
  assert.equal(finish.metric, "latency");
  assert.equal(finish.direction, "lower");
  assert.equal(finish.deadline, "2099-12-01T00:00:00.000Z");
  assert.equal(finish.budget, "50.00");
});

test("the work order is on the page before the script runs", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const form = html.slice(html.indexOf("<form id=\"request-form\""), html.indexOf("</form>", html.indexOf("<form id=\"request-form\"")));
  assert.doesNotMatch(form, /\shidden[\s>]/);
  assert.match(form, /Open X draft/);
  assert.match(form, /name="text" value="@clanksmith "/);
  assert.match(html, /id="request-fallback"/);
  assert.match(html, /Post a job on X\./);
  assert.match(html, /Pay when it passes\./);
  assert.match(html, /id="request-mode"/);
  assert.match(html, /Speed\.<\/b> Set a metric and a target/);
  assert.match(html, /Quality\.<\/b> Set a metric, whether higher or lower is better/);
  assert.doesNotMatch(html, /—/);
});

test("the board uses the live page copy and absolute share tags", () => {
  const html = readFileSync(new URL("../board/public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /Reply with an intent/);
  assert.doesNotMatch(html, /wordmark/);
  assert.match(html, /Post a job on X\. Pay when it passes\./);
  assert.match(html, /property="og:url" content="https:\/\/clanksmith\.com\/board\/"/);
  assert.match(html, /property="og:image" content="https:\/\/clanksmith\.com\/og\.jpg"/);
  assert.match(html, /class="tag speed"/);
  assert.match(html, /class="tag quality"/);
  assert.match(html, /The first submission that hits the target wins/);
  assert.match(html, /A tie goes to the earlier submission/);
  assert.doesNotMatch(html, /—/);
  const css = readFileSync(new URL("../board/public/board.css", import.meta.url), "utf8");
  assert.match(css, /#totals:empty\{display:none\}/);
});

test("missing scope, invalid money, and oversized drafts cannot open X", () => {
  assert.throws(() => buildRequestPost({ ...brief, done: "  " }), /task and what counts as done/);
  assert.throws(() => buildRequestPost({ ...brief, budget: "0.001" }), /budget/);
  assert.throws(() => buildRequestPost({ ...brief, currency: "NEAR" }), /USD or USDC/);
  assert.throws(() => buildRequestPost({ ...brief, deadline: "2026-02-30" }), /real deadline/);
  assert.throws(() => buildRequestPost({ ...brief, deadline: "2000-01-01" }), /real deadline/);
  assert.throws(() => buildRequestPost({ ...brief, task: "x".repeat(200) }), /Shorten/);
});
