import assert from "node:assert/strict";
import test from "node:test";
import { readBrief } from "./brief.mjs";
import { createMemoryInbox } from "./inbox.mjs";
import { handleRequest } from "../site.mjs";
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

test("the seeded Paraloom listing names the pool, the four tiers, and the program", async () => {
  const job = seedJobs().find((row) => row.id === "x2124329425684791409");
  assert.ok(job);
  assert.equal(job.id, "x2124329425684791409");
  assert.equal(job.url, "https://clanksmith.com/jobs/x2124329425684791409");
  assert.equal(job.sourcePostId, "2124329425684791409");
  assert.equal(job.sourceUrl, "https://x.com/W3B_AI_SR/status/2124329425684791409");
  assert.equal(job.title, "Paraloom Stage 1 bug bounty");
  assert.equal(job.payerName, "Paraloom");
  assert.equal(job.payerKind, "third-party");
  assert.equal(job.payLine, "3000 USDC pool");
  assert.deepEqual(job.amounts, [
    { amount: "3000", currency: "USDC", tier: "pool" },
    { amount: "1000", currency: "USDC", tier: "critical" },
    { amount: "400", currency: "USDC", tier: "high" },
    { amount: "150", currency: "USDC", tier: "medium" },
    { amount: "50", currency: "USDC", tier: "low" },
  ]);
  assert.deepEqual(job.amountLines, [
    "3000 USDC pool",
    "up to 1000 USDC for a critical bug",
    "up to 400 USDC for a high bug",
    "up to 150 USDC for a medium bug",
    "up to 50 USDC for a low bug",
  ]);
  assert.equal(job.email, "security@paraloom.network");
  assert.equal(job.repo, "https://github.com/paraloom-labs/paraloom-core");
  assert.match(job.submit, /security@paraloom\.network/);
  assert.match(job.submit, /Do not open a public issue/);
  assert.match(job.scope, /shielded-pool settlement stack/);
  assert.match(job.scope, /compute layer is out of scope/);
  assert.match(job.paymentNote, /Payment comes from Paraloom, the program named in the source post/);
  assert.match(job.paymentNote, /not from Clanksmith/i);
  assert.equal(job.task.includes("paraloom-labs/paraloom-core"), true);
  const copy = [job.title, job.task, job.payLine, job.submit, job.scope, job.paymentNote, ...job.amountLines].join("\n");
  assert.equal(copy.includes("\u2014"), false);
  assert.equal(copy.includes("\u2013"), false);
  assert.equal(seedJobs().filter((row) => row.sourcePostId === "2124329425684791409").length, 1);

  const response = await handleRequest(new Request("https://clanksmith.com/jobs/x2124329425684791409"), {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Paraloom Stage 1 bug bounty/);
  assert.match(html, /<strong>Paraloom<\/strong>/);
  assert.match(html, /3000 USDC pool/);
  assert.match(html, /up to 1000 USDC for a critical bug/);
  assert.match(html, /up to 400 USDC for a high bug/);
  assert.match(html, /up to 150 USDC for a medium bug/);
  assert.match(html, /up to 50 USDC for a low bug/);
  assert.match(html, /security@paraloom\.network/);
  assert.match(html, /https:\/\/github\.com\/paraloom-labs\/paraloom-core/);
  assert.match(html, /https:\/\/x\.com\/W3B_AI_SR\/status\/2124329425684791409/);
  assert.match(html, /not from Clanksmith/i);
  assert.equal(html.includes("\u2014"), false);
  assert.equal(html.includes("\u2013"), false);
  assert.equal(html.includes(">000<"), false);
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
