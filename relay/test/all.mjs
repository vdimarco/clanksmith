// Mocked market. No live call, no key, no payment.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { agentIdFor, parsePayout } from "../address.mjs";
import { demoJob, mockFetch, otherMarketJob } from "../catalog.mjs";
import { relayConfig } from "../config.mjs";
import { doName } from "../jobs.mjs";
import { approvePayout, emptyState } from "../ledger.mjs";
import { scoreSubmission, parseProof } from "../proof.mjs";
import { apply } from "../service.mjs";
import { createMarket } from "../../market/client.mjs";
import { runDemo } from "../demo.mjs";
import { buildAttempt } from "../../agents/solver.mjs";

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const NOW = "2026-11-14T08:00:00.000Z";
const token = "aat_testtoken0123456789abcdef";

ok("dry run is the default", relayConfig({}).dryRun === true && relayConfig({}).liveWrites === false);
ok("live writes need both switches", relayConfig({ CLANKSMITH_LIVE_WRITES: "true", AGENT_MARKET_DRY_RUN: "false" }).liveWrites === true);
ok("the live flag alone does not send writes", relayConfig({ CLANKSMITH_LIVE_WRITES: "true" }).dryRun === true);
ok("turning dry run off alone does not send writes", relayConfig({ AGENT_MARKET_DRY_RUN: "false" }).dryRun === true);

const near = parsePayout("Demo.Solver.near");
ok("a NEAR account is accepted", near.ok && near.kind === "near" && near.address === "demo.solver.near");
const eth = parsePayout("0xAbCd00000000000000000000000000000000eF12");
ok("an 0x address is an ETH or USDC payout", eth.ok && eth.kind === "eth");
ok("usdc: prefix is kept", parsePayout("usdc:0xAbCd00000000000000000000000000000000eF12").kind === "usdc");
ok("a secret is refused", parsePayout("aat_abcdef").ok === false);
ok("the same address always makes the same agent id", agentIdFor(near.address) === agentIdFor("demo.solver.near") && agentIdFor(near.address).startsWith("cs_"));
ok("a job id becomes a durable object name", doName("job/demo 1") === "job_demo_1");

const proof = parseProof(demoJob().description);
ok("the sample bounty has a proof check", proof?.checks.length === 3 && proof.minScore === 80);
const passingWork = buildAttempt({ title: "Write a launch blurb for Clanksmith", proof }, "auto");
ok("the sample attempt passes", scoreSubmission(proof, passingWork).pass === true && scoreSubmission(proof, passingWork).score === 100);
ok("a short note fails", scoreSubmission(proof, { text: "nope", urls: [], files: [] }).pass === false);

function ctxFor(config, fetchImpl) {
  const market = createMarket({ config, dryRun: config.dryRun, fetchImpl });
  return { market, config, now: () => NOW };
}

const board = mockFetch([demoJob(), otherMarketJob(), {
  ...demoJob(),
  jobId: "job-closed",
  entriesCloseAt: "2020-01-01T00:00:00.000Z",
  title: "Closed blurb",
}]);
const dry = ctxFor(relayConfig({ AGENT_MARKET_AGENT_TOKEN: token }), board.fetchImpl);
let state = emptyState();

const listed = await apply(state, "list_jobs", { payout_address: "demo.solver.near" }, dry);
state = listed.state;
ok("list_jobs returns the open Clanksmith bounty only", listed.result.ok && listed.result.jobs.length === 1 && listed.result.jobs[0].jobId === "job-demo-1");
ok("list_jobs carries reward, currency, deadline, and proof summary", listed.result.jobs[0].reward === "25.00" && listed.result.jobs[0].currency === "USDC" && listed.result.jobs[0].deadline.startsWith("2026-12-01") && /JSON blurb/.test(listed.result.jobs[0].proofSummary));
ok("onboarding returns an agent id and no token", listed.result.agent.agentId === agentIdFor("demo.solver.near") && !JSON.stringify(listed.result).includes(token));
ok("the board read used the agent token and did not write", board.calls.every((call) => call.method === "GET") && board.calls[0].auth === `Bearer ${token}`);

const full = await apply(state, "get_job", { job_id: "job-demo-1", payout_address: "demo.solver.near" }, dry);
ok("get_job returns the exact proof check", full.result.job.proof.checks[0].required.join() === "title,url" && /one entry per builder/.test(full.result.job.acceptance));
const hidden = await apply(state, "get_job", { job_id: "job-other" }, dry);
ok("a bounty from another buyer is refused", hidden.result.ok === false);

const weak = await apply(state, "submit", {
  job_id: "job-demo-1",
  payout_address: "weak.solver.near",
  text: "A short note that does not follow the spec.",
}, dry);
state = weak.state;
ok("a failing submission is stored and not forwarded", weak.result.ok && weak.result.preJudge.pass === false && weak.result.preJudge.forwarded === false && weak.result.forward == null);
ok("a failing row is not owed a payout", weak.result.submission.payout.state === "failed" && weak.result.submission.payout.fundsMoved === false);

const strong = await apply(state, "submit", {
  job_id: "job-demo-1",
  payout_address: "demo.solver.near",
  text: passingWork.text,
  urls: passingWork.urls,
  files: passingWork.files,
  client_request_id: "once",
}, dry);
state = strong.state;
ok("the better submission is forwarded as a dry run", strong.result.preJudge.forwarded === true && strong.result.preJudge.score === 100 && strong.result.forward.dryRun === true);
ok("the planned entry is one competition enter and one submit", strong.result.forward.calls.map((call) => call.path).join(" ") === "/v1/jobs/job-demo-1/entries /v1/assignments/dry-run/submit");
ok("the planned deliverable omits the payout address", !JSON.stringify(strong.result.forward).includes("demo.solver.near") && !JSON.stringify(state.forwards).includes("demo.solver.near"));
ok("dry run still has not written to the market", board.calls.every((call) => call.method === "GET"));

const replay = await apply(state, "submit", {
  job_id: "job-demo-1",
  payout_address: "demo.solver.near",
  text: passingWork.text,
  urls: passingWork.urls,
  client_request_id: "once",
}, dry);
state = replay.state;
ok("the same client request id does not add a second row", replay.result.replayed === true && state.submissions.length === 2);

const again = await apply(state, "status", { job_id: "job-demo-1", payout_address: "demo.solver.near" }, dry);
ok("status shows pass, score, and owed for the caller only", again.result.submissions.length === 1 && again.result.submissions[0].proof.pass === true && again.result.submissions[0].payout.state === "owed");
const peek = await apply(state, "status", { job_id: "job-demo-1", submission_id: strong.result.submission.submissionId, payout_address: "weak.solver.near" }, dry);
ok("status does not reveal another agent's submission", peek.result.submissions.length === 0);

const lower = await apply(state, "submit", {
  job_id: "job-demo-1",
  payout_address: "other.solver.near",
  text: passingWork.text.slice(0, 40),
  urls: ["https://clanksmith.com"],
}, dry);
state = lower.state;
ok("a lower score does not replace the forwarded entry", lower.result.preJudge.forwarded === false && state.forwards.filter((row) => !row.superseded).length === 1);

const ladderProof = {
  summary: "Two steps.",
  minScore: 50,
  checks: [
    { id: "a", type: "includes", points: 50, value: "alpha" },
    { id: "b", type: "includes", points: 50, value: "beta" },
  ],
};
const ladder = {
  jobId: "job-ladder",
  jobKind: "competition",
  title: "Ladder",
  budgetAmount: "10.00",
  budgetToken: "USDC",
  entriesCloseAt: "2026-12-01T00:00:00.000Z",
  tags: ["clanksmith"],
  description: `Site: https://clanksmith.com\n\n\`\`\`clanksmith-proof\n${JSON.stringify(ladderProof)}\n\`\`\``,
};
const ladderMock = mockFetch([ladder]);
const ladderCtx = ctxFor(relayConfig({}), ladderMock.fetchImpl);
let ladderState = emptyState();
const firstPass = await apply(ladderState, "submit", { job_id: "job-ladder", payout_address: "first.solver.near", text: "alpha only" }, ladderCtx);
ladderState = firstPass.state;
const secondPass = await apply(ladderState, "submit", { job_id: "job-ladder", payout_address: "second.solver.near", text: "alpha and beta" }, ladderCtx);
ladderState = secondPass.state;
ok("a higher score replaces the forwarded entry", firstPass.result.preJudge.score === 50 && firstPass.result.preJudge.forwarded === true && secondPass.result.preJudge.score === 100 && secondPass.result.preJudge.forwarded === true);
ok("the replacement does not enter the competition twice", secondPass.result.forward.calls.map((call) => call.path).join(" ") === "/v1/assignments/dry-run/submit");
ok("only the new forward stays active", ladderState.forwards.filter((row) => !row.superseded).length === 1 && ladderState.forwards.find((row) => !row.superseded).submissionId === secondPass.result.submission.submissionId);

const approved = approvePayout(state, strong.result.submission.submissionId);
ok("approval flips the row and moves no funds", approved.ok && approved.submission.payout.state === "approved" && approved.submission.payout.fundsMoved === false);
const refused = approvePayout(approved.state, weak.result.submission.submissionId);
ok("a failed row cannot be approved", refused.ok === false);

const dir = mkdtempSync(join(tmpdir(), "clanksmith-"));
const file = join(dir, "ledger.json");
writeFileSync(file, JSON.stringify(state));
const cli = spawnSync(process.execPath, ["relay/payout.mjs", "approve", file, strong.result.submission.submissionId], { encoding: "utf8" });
ok("the payout command approves without sending funds", cli.status === 0 && cli.stdout.includes("No funds moved.") && JSON.parse(readFileSync(file, "utf8")).submissions.find((row) => row.submissionId === strong.result.submission.submissionId).payout.fundsMoved === false);

const liveCalls = [];
const liveFetch = async (url, init = {}) => {
  const target = new URL(url);
  liveCalls.push({ method: init.method, path: target.pathname, auth: init.headers?.authorization || "", body: init.body || "" });
  const json = (row) => ({ ok: true, status: 200, text: async () => JSON.stringify(row) });
  if (init.method === "GET" && target.pathname === "/v1/jobs/board") return json({ jobs: [demoJob()] });
  if (init.method === "GET") return json(demoJob());
  if (init.method === "POST" && target.pathname.endsWith("/entries")) return json({ assignmentId: "as-live" });
  if (init.method === "POST" && target.pathname.endsWith("/submit")) return json({ status: "submitted" });
  return json({ unexpected: target.pathname });
};
const liveCfg = relayConfig({
  CLANKSMITH_LIVE_WRITES: "true",
  AGENT_MARKET_DRY_RUN: "false",
  AGENT_MARKET_AGENT_TOKEN: token,
  AGENT_MARKET_BASE: "https://market.near.ai",
});
const live = await apply(emptyState(), "submit", {
  job_id: "job-demo-1",
  payout_address: "demo.solver.near",
  text: passingWork.text,
  urls: passingWork.urls,
}, ctxFor(liveCfg, liveFetch));
ok("a live submit enters, then submits on the returned assignment", liveCalls.filter((call) => call.method === "POST").map((call) => call.path).join(" ") === "/v1/jobs/job-demo-1/entries /v1/assignments/as-live/submit");
ok("the live bearer is the agent token and the ledger does not keep it", liveCalls.some((call) => call.auth === `Bearer ${token}`) && !JSON.stringify(live.state).includes(token) && !JSON.stringify(live.result).includes(token));

const blockedCalls = [];
const blockedFetch = async (url, init = {}) => {
  blockedCalls.push(init.method);
  if (init.method !== "GET") throw new Error("should not write");
  const target = new URL(url);
  const json = (row) => ({ ok: true, status: 200, text: async () => JSON.stringify(row) });
  if (target.pathname === "/v1/jobs/board") return json({ jobs: [demoJob()] });
  return json(demoJob());
};
const blocked = await apply(emptyState(), "submit", {
  job_id: "job-demo-1",
  payout_address: "demo.solver.near",
  text: passingWork.text,
  urls: passingWork.urls,
}, ctxFor(relayConfig({ CLANKSMITH_LIVE_WRITES: "true", AGENT_MARKET_DRY_RUN: "false" }), blockedFetch));
ok("live mode without a token sends no write", blocked.result.submission.payout.state === "hold" && blockedCalls.every((method) => method === "GET"));

let crowded = emptyState();
for (let i = 0; i < 3; i++) {
  const row = await apply(crowded, "submit", { job_id: "job-demo-1", payout_address: "crowd.solver.near", text: `note ${i}` }, dry);
  crowded = row.state;
}
const fourth = await apply(crowded, "submit", { job_id: "job-demo-1", payout_address: "crowd.solver.near", text: "note 4" }, dry);
ok("a fourth submission on one bounty is refused", fourth.result.ok === false && /3 submissions/.test(fourth.result.error));

const worker = readFileSync(new URL("../../mcp/worker.mjs", import.meta.url), "utf8");
ok("the worker is a durable object and does not embed a token", worker.includes("extends DurableObject") && worker.includes("CLANKSMITH_LIVE_WRITES") && !worker.includes("aat_"));
const mcpWrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
ok("the mcp config keeps writes off and does not publish a workers.dev url", mcpWrangler.includes('"name": "clanksmith-mcp"') && mcpWrangler.includes('"CLANKSMITH_LIVE_WRITES": "false"') && mcpWrangler.includes('"workers_dev": false'));
const siteWrangler = readFileSync(new URL("../../worker/wrangler.jsonc", import.meta.url), "utf8");
ok("deploy targets the existing clanksmith worker with writes off", siteWrangler.includes('"name": "clanksmith"') && !siteWrangler.includes("clanksmith-mcp") && siteWrangler.includes('"CLANKSMITH_LIVE_WRITES": "false"') && siteWrangler.includes('"AGENT_MARKET_DRY_RUN": "true"') && siteWrangler.includes('"workers_dev": true') && siteWrangler.includes('"custom_domain": true') && siteWrangler.includes('"../site"'));

const demo = await runDemo();
const log = demo.log;
ok("demo log shows list, submit, pre-judge, forward, and ledger", ["list_jobs", "submit", "pre-judge", "POST /v1/jobs/job-demo-1/entries", "POST /v1/assignments/dry-run/submit", "ledger entry", "owed", "No funds moved.", "market writes sent 0"].every((part) => log.includes(part)));
ok("demo log does not contain the sample token", !log.includes("aat_demo"));
ok("demo exits clean", demo.ok === true, demo.ok ? "" : log.slice(-400));

console.log(fails ? `\n${fails} failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
