// X reply -> Agent Market job. Dry run plans every mutating call and sends none.
import { parseMention } from "../x/parse.mjs";
import { checkMarkdown } from "./proof.mjs";
import { appealDraft, onChainPost } from "./link.mjs";

export function money(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function jobBody(mention, cfg) {
  const cap = money(cfg.budgetCap);
  const guide = Math.min(mention.budgetNear, cap ?? mention.budgetNear);
  const spec = JSON.stringify(mention.spec);
  return {
    title: mention.title.slice(0, 80),
    description: [
      `Mention: ${mention.raw}`,
      `Kind: ${mention.kind}`,
      `Spec: ${spec}`,
      `On-chain contract: ${cfg.onChainContract} (${cfg.onChainNetwork})`,
      "Deliver Markdown with one ```json fence. The object is the work the NEAR contract checks.",
      "Clanksmith accepts the delivery only after that check passes.",
    ].join("\n"),
    budgetAmount: guide.toFixed(2),
    token: "USDC",
    acceptanceWindowDays: cfg.acceptanceWindowDays,
    maxSlots: 1,
    tags: ["clanksmith", mention.kind],
  };
}

export function pickBid(bids, cap) {
  const limit = money(cap);
  const open = (bids || []).filter((b) => {
    const status = b.status || "pending";
    const amount = money(b.amount);
    return status === "pending" && amount != null && amount > 0 && (limit == null || amount <= limit);
  });
  open.sort((a, b) => money(a.amount) - money(b.amount));
  return open[0] || null;
}

export function reviewPlan(verdict, version = 1) {
  if (verdict.pass) return { action: "accept" };
  const feedback = verdict.reason || "proof check failed";
  if (version > 1) return { action: "dispute", body: { reason: feedback } };
  return { action: "request-changes", body: { feedback } };
}

function idOf(row, ...keys) {
  for (const k of keys) if (row && row[k]) return row[k];
  return null;
}

export async function hireFromMention(mentionText, { client, cfg, bids, deliverable, version = 1, receipt }) {
  const mention = parseMention(mentionText);
  const cap = money(cfg.budgetCap);
  if (cap != null && mention.budgetNear > cap) {
    return { ok: false, phase: "over-cap", mention, budgetCap: cfg.budgetCap };
  }
  const body = jobBody(mention, cfg);
  const created = await client.post("/v1/jobs", body, "buyer");
  const marketJobId = created?.dryRun ? null : idOf(created, "jobId", "job_id", "id");
  const chosen = pickBid(bids, cfg.budgetCap);
  const planned = { mention, job: body, marketJobId, bid: chosen ? { bidId: idOf(chosen, "bidId", "bid_id", "id"), amount: chosen.amount } : null };

  if (!chosen) {
    return { ok: true, phase: "no-bid", dryRun: !!created?.dryRun, ...planned, onChain: null };
  }
  const jobId = marketJobId || "dry-run";
  const awardPath = `/v1/jobs/${jobId}/award`;
  const awardBody = { bidId: planned.bid.bidId };
  const awarded = await client.post(awardPath, awardBody, "buyer");
  const assignmentId = awarded?.dryRun ? null : idOf(awarded, "assignmentId", "assignment_id");

  if (!deliverable) {
    return {
      ok: true,
      phase: created?.dryRun ? "would-award" : "awarded",
      dryRun: !!created?.dryRun,
      ...planned,
      assignmentId,
      onChain: onChainPost(mention, marketJobId || "pending", { id: cfg.onChainContract, network: cfg.onChainNetwork }),
    };
  }

  const verdict = checkMarkdown(mention.kind, mention.spec, deliverable);
  const decision = reviewPlan(verdict, version);
  const target = assignmentId || "dry-run";
  let sent = null;
  if (decision.action === "accept") {
    sent = await client.post(`/v1/assignments/${target}/accept`, {}, "buyer");
  } else if (decision.action === "request-changes") {
    sent = await client.post(`/v1/assignments/${target}/request-changes`, decision.body, "buyer");
  } else {
    sent = await client.post(`/v1/assignments/${target}/dispute`, decision.body, "buyer");
  }
  const appeal = verdict.pass ? null : appealDraft(receipt || null);
  return {
    ok: true,
    phase: decision.action,
    dryRun: !!created?.dryRun || !!sent?.dryRun,
    ...planned,
    assignmentId,
    verdict,
    appeal,
    onChain: onChainPost(mention, marketJobId || "pending", { id: cfg.onChainContract, network: cfg.onChainNetwork }),
  };
}
