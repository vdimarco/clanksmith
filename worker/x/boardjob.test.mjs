import assert from "node:assert/strict";
import test from "node:test";
import { readBrief } from "./brief.mjs";
import { createMemoryInbox } from "./inbox.mjs";
import { AKTIONARIAT_POST, boardJobUrl, collectJobs, publishBoardJob, renderIndex, renderJob, seedJobs } from "./boardjob.mjs";

test("the seeded Aktionariat listing names the program, the payout, and the source post", () => {
  const [job] = seedJobs();
  assert.equal(job.id, "x2121989097954697556");
  assert.equal(job.url, "https://clanksmith.com/jobs/x2121989097954697556");
  assert.equal(job.payerName, "Aktionariat");
  assert.equal(job.payerKind, "third-party");
  assert.deepEqual(job.amountLines, ["3 ETH for a high-impact bug", "1 ETH for a medium bug"]);
  assert.match(job.submit, /bugs@aktionariat.com/);
  assert.match(job.submit, /Hardhat PoC against master/);
  assert.equal(job.email, "bugs@aktionariat.com");
  assert.equal(job.sourceUrl, "https://x.com/W3B_AI_SR/status/2121989097954697556");
  assert.match(job.paymentNote, /not from Clanksmith/i);
  assert.equal(job.paymentNote.includes("proto_von"), false);
  assert.equal(AKTIONARIAT_POST.includes("3 ETH"), true);
});

test("the job page and the index show the payout and do not move money", () => {
  const [job] = seedJobs();
  const page = renderJob(job);
  const index = renderIndex(seedJobs());
  for (const html of [page, index]) {
    assert.match(html, /Aktionariat/);
    assert.match(html, /3 ETH/);
    assert.match(html, /1 ETH/);
    assert.match(html, /not from Clanksmith/i);
    assert.equal(html.includes("\u2014"), false);
    assert.equal(html.includes("\u2013"), false);
    assert.equal(html.includes("<script"), false);
  }
  assert.match(page, /bugs@aktionariat.com/);
  assert.match(page, /https:\/\/x\.com\/W3B_AI_SR\/status\/2121989097954697556/);
  assert.match(page, /Review the public contracts/);
  assert.match(page, /name="agent_name"/);
  assert.match(page, /name="writeup"/);
  assert.match(page, /Send a report/);
  assert.match(page, /\.pg \.stamp\{[^}]*padding:10px 14px/);
  assert.match(page, /\.ticket-h\{[^}]*gap:18px[^}]*padding:18px/);
  assert.match(page, /does not publish it/);
  assert.match(index, /href="\/jobs\/x2121989097954697556"/);
  assert.equal(boardJobUrl(job.id), job.url);
});

test("a hostile field is escaped and a second save of the same post is one listing", async () => {
  const inbox = createMemoryInbox();
  const brief = readBrief({
    id: "77",
    username: "ada",
    text: "@clanksmith make a logo for 2 ETH",
  });
  const first = await publishBoardJob(brief, inbox, Date.parse("2026-11-15T18:00:00.000Z"));
  const second = await publishBoardJob(brief, inbox, Date.parse("2026-11-15T19:00:00.000Z"));
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.job.id, first.job.id);
  const nasty = { ...first.job, title: "<script>alert(1)</script>", payerName: "A<img src=x>" };
  const html = renderJob(nasty);
  assert.equal(html.includes("<script>alert"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  const jobs = await collectJobs(inbox);
  assert.equal(jobs.filter((job) => job.sourcePostId === "77").length, 1);
  assert.equal(jobs.some((job) => job.id === "x2121989097954697556"), true);
});

test("the seeded post is not stored a second time", async () => {
  const inbox = createMemoryInbox();
  const brief = readBrief({
    id: "2122006059141263643",
    username: "proto_von",
    text: "@W3B_AI_SR @clanksmith check out the above",
    parentId: "2121989097954697556",
    parentText: AKTIONARIAT_POST,
    parentUsername: "W3B_AI_SR",
  });
  const published = await publishBoardJob(brief, inbox);
  assert.equal(published.replayed, true);
  assert.equal(published.job.id, "x2121989097954697556");
  assert.equal((await inbox.listBoardJobs()).length, 0);
});
