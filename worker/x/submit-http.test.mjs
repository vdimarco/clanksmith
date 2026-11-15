import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../site.mjs";
import { createMemoryInbox } from "./inbox.mjs";

const env = {
  X_REVIEW_TOKEN: "review-token",
  ASSETS: { fetch: () => new Response("asset", { status: 200 }) },
};

function postReport(inbox) {
  const body = new URLSearchParams({
    agent_name: "Ink",
    contact: "ink@example.com",
    payout: "ink.near",
    writeup: "A short note for the program about the public bounty.",
    link: "https://gist.github.com/example/abc",
  });
  return handleRequest(new Request("https://clanksmith.com/jobs/x2121989097954697556/submissions", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }), env, { jobsInbox: inbox });
}

test("a form post is held, the receipt hides the write-up, and review needs the token", async () => {
  const inbox = createMemoryInbox();
  const posted = await postReport(inbox);
  assert.equal(posted.status, 303);
  const location = posted.headers.get("location");
  assert.match(location, /\/jobs\/receipts\/rcpt_[0-9a-f]{32}$/);

  const page = await handleRequest(new Request(location), env, { jobsInbox: inbox });
  const html = await page.text();
  assert.match(html, /Held for review/);
  assert.equal(html.includes("short note for the program"), false);

  const job = await handleRequest(new Request("https://clanksmith.com/jobs/x2121989097954697556"), env, { jobsInbox: inbox });
  const jobHtml = await job.text();
  assert.match(jobHtml, /name="writeup"/);
  assert.match(jobHtml, /Submit report/);
  assert.equal(jobHtml.includes("short note for the program"), false);

  const closed = await handleRequest(new Request("https://clanksmith.com/jobs/review"), env, { jobsInbox: inbox });
  assert.equal(closed.status, 401);
  const hidden = await handleRequest(new Request("https://clanksmith.com/jobs/review"), { ASSETS: env.ASSETS }, { jobsInbox: inbox });
  assert.equal(hidden.status, 404);
  const open = await handleRequest(new Request("https://clanksmith.com/jobs/review", {
    headers: { authorization: "Bearer review-token" },
  }), env, { jobsInbox: inbox });
  const review = await open.json();
  assert.equal(review.items[0].writeup, undefined);
  const full = await handleRequest(new Request("https://clanksmith.com/jobs/review/" + review.items[0].id, {
    headers: { authorization: "Bearer review-token" },
  }), env, { jobsInbox: inbox });
  const detail = await full.json();
  assert.match(detail.writeup, /short note for the program/);
  assert.equal(JSON.stringify(detail).includes("review-token"), false);
});
