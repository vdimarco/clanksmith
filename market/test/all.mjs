import { marketConfig } from "../config.mjs";
import { createMarket } from "../client.mjs";
import { hireFromMention, pickBid, reviewPlan } from "../hire.mjs";
import { chainTitle } from "../link.mjs";
import { checkMarkdown, contrastX100 } from "../proof.mjs";
import { planWorker } from "../worker.mjs";

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${name}`); if (!cond) fails++; };

ok("dry run defaults on", marketConfig({}).dryRun === true);
ok("dry run turns off only when set false", marketConfig({ AGENT_MARKET_DRY_RUN: "false" }).dryRun === false);
ok("budget cap defaults to 0.50", marketConfig({}).budgetCap === "0.50");
ok("acceptance window stays inside 3 to 7", marketConfig({ AGENT_MARKET_ACCEPTANCE_DAYS: "9" }).acceptanceWindowDays === 7);

const title = chainTitle("logo", "11111111-2222-3333-4444-555555555555");
ok("ledger title carries the market id and fits the chain", title.includes("mkt:11111111-2222-3333-4444-555555555555") && title.length <= 80);

ok("black on white contrast is 21:1", contrastX100([0, 0, 0], [255, 255, 255]) === 2100);
const passPaint = checkMarkdown("paint", { contrast_x100: 450 }, '```json\n{"floor":"#000000","wall":"#ffffff","accent":"#ff6a1a"}\n```');
ok("a passing swatch passes", passPaint.pass === true);
const failPaint = checkMarkdown("paint", { contrast_x100: 450 }, '```json\n{"floor":"#888888","wall":"#999999","accent":"#aaaaaa"}\n```');
ok("a flat swatch fails", failPaint.pass === false);

ok("a bid over the cap is not awarded", pickBid([{ id: "high", amount: "0.90", status: "pending" }, { id: "low", amount: "0.40", status: "pending" }], "0.50")?.id === "low");
ok("a failed first delivery requests changes", reviewPlan(failPaint, 1).action === "request-changes");
ok("a failed rework opens a dispute", reviewPlan(failPaint, 2).action === "dispute");
ok("a pass accepts", reviewPlan(passPaint, 1).action === "accept");

let called = false;
const dry = createMarket({ dryRun: true, fetchImpl: () => { called = true; throw new Error("network"); } });
const over = await hireFromMention("@clanksmith make me a logo, 5 NEAR", {
  client: dry,
  cfg: marketConfig({ AGENT_MARKET_BUDGET_CAP: "0.50" }),
});
ok("a mention above the cap does not call the network", over.phase === "over-cap" && called === false);

const planned = await hireFromMention("@clanksmith make me a logo, 0.2 NEAR", {
  client: dry,
  cfg: marketConfig({}),
  bids: [{ bidId: "bid-1", amount: "0.20", status: "pending" }],
  deliverable: '```json\n{"floor":"#000000","wall":"#ffffff","accent":"#ff6a1a"}\n```',
});
ok("dry run plans post, award, and accept", planned.phase === "accept" && planned.dryRun === true && dry.planned.map((p) => p.path).join(" ") === "/v1/jobs /v1/jobs/dry-run/award /v1/assignments/dry-run/accept");
ok("the planned job names the on-chain contract", planned.job.description.includes("ee4994a509efa3cc516411e75f2633b2d8eac2d05fc30cc558bfd43329cde827"));

const calls = [];
function mockFetch(url, init) {
  const path = new URL(url).pathname;
  calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization || "" });
  const json = (row) => ({ ok: true, status: 200, text: async () => JSON.stringify(row) });
  if (init.method === "POST" && path === "/v1/jobs") return json({ jobId: "job-9" });
  if (init.method === "GET" && path === "/v1/jobs/job-9/bids") return json({ bids: [{ bidId: "bid-9", amount: "0.20", status: "pending" }] });
  if (init.method === "POST" && path === "/v1/jobs/job-9/award") return json({ assignmentId: "as-9" });
  if (init.method === "GET" && path === "/v1/assignments/as-9/deliverable/raw") return json({ deliverableMarkdown: '```json\n{"floor":"#888888","wall":"#999999","accent":"#aaaaaa"}\n```' });
  if (init.method === "POST" && path === "/v1/assignments/as-9/request-changes") return json({ status: "in_progress" });
  return json({ unexpected: path });
}
const live = createMarket({
  dryRun: false,
  buyerKey: "buyer-test",
  base: "https://market.near.ai",
  fetchImpl: (url, init) => mockFetch(url, { ...init, headers: init.headers }),
});
const failed = await hireFromMention("@clanksmith make me a logo, 0.2 NEAR", {
  client: live,
  cfg: marketConfig({ AGENT_MARKET_DRY_RUN: "false", AGENT_MARKET_BUDGET_CAP: "0.50" }),
  bids: [{ bidId: "bid-9", amount: "0.20", status: "pending" }],
  deliverable: '```json\n{"floor":"#888888","wall":"#999999","accent":"#aaaaaa"}\n```',
  receipt: {
    jobId: 1, receiptId: 2, kind: "paint", worker: "seller.near", buyer: "buyer.near",
    price: "200000000000000000000000", spec: "{\"contrast_x100\":450}", reason: "flat", data: "{}",
  },
});
ok("a live-shaped client posts, awards, and requests changes", calls.map((c) => `${c.method} ${c.path}`).join(" | ") === "POST /v1/jobs | POST /v1/jobs/job-9/award | POST /v1/assignments/as-9/request-changes");
ok("the buyer key is the bearer", calls[0].auth === "Bearer buyer-test");
ok("a failed proof prepares an appeal hash and does not accept", failed.phase === "request-changes" && failed.appeal.ready === true && /^[0-9a-f]{64}$/.test(failed.appeal.evidenceHash));
ok("the on-chain title the ledger shows includes the market job", failed.onChain.args.title.includes("mkt:job-9") && failed.onChain.signs === false);

const actions = planWorker([
  { assignment: { assignmentId: "a1", status: "in_progress", startedAt: null, submittedAt: null } },
  { assignment: { assignmentId: "a2", status: "in_progress", startedAt: "t", submittedAt: "t" }, latestMessage: { senderSide: "buyer", body: "redo the contrast" } },
  { assignment: { assignmentId: "a3", status: "submitted", startedAt: "t", submittedAt: "t" } },
]);
ok("the worker starts a fresh hire, resubmits rework, and skips a delivery in review", actions.map((a) => a.action).join(" ") === "start resubmit skip");

console.log(fails ? `\n${fails} failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
