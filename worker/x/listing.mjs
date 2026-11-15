// Turns an explicit brief into one market job per source post.
// Live sends stay off. POST /v1/jobs/competition locks a USDC pool from the
// buyer key, and this market has no external-payer field. A third-party ETH
// bounty must not be escrowed as if the tagger or the buyer key were paying it.

import { createMarket } from "../../market/client.mjs";

export function listingMode(env = {}) {
  const mode = String(env.X_MARKET_LISTINGS || "off").trim().toLowerCase();
  if (mode === "live" || mode === "dry-run") return mode;
  return "off";
}

export function liveListingBlock(brief, _env = {}) {
  if (!brief?.explicit) return "incomplete";
  const currencies = new Set((brief.amounts || []).map((row) => row.currency));
  const heldByMarket = currencies.size > 0 && [...currencies].every((currency) => currency === "USDC" || currency === "USD");
  if (brief.payerKind === "third-party" && !heldByMarket) return "external-bounty-not-escrowed";
  return "market-create-would-spend-buyer-balance";
}

export function marketBody(brief) {
  const high = brief.amounts.find((row) => row.tier === "high");
  const medium = brief.amounts.find((row) => row.tier === "medium");
  const repo = brief.repo ? "https://" + String(brief.repo).replace(/^https?:\/\//, "") : "";
  const lines = [
    "Paid by " + brief.payerName + ", not by @" + brief.tagger + ".",
    brief.payerKind === "third-party"
      ? "This is a third-party bounty. The posting account does not pay it, and an award must not debit that account."
      : "The person who posted the job named this budget. An award must not debit a different account.",
    high ? "High-impact bugs pay " + high.amount + " " + high.currency + "." : "",
    medium ? "Medium bugs pay " + medium.amount + " " + medium.currency + "." : "",
    brief.amounts.filter((row) => !row.tier).map((row) => "Stated budget: " + row.amount + " " + row.currency + ".").join(" "),
    /takeover or drain/i.test(brief.text || "")
      ? "The program describes high-impact as takeover or drain of a token, market, or payment hub."
      : "",
    brief.deliverable ? "Deliverable: a " + brief.deliverable + "." : "",
    brief.email ? "Submit to " + brief.email + "." : "",
    repo ? "Repository: " + repo + "." : "",
    "Source post id: " + brief.sourcePostId + ".",
    brief.sourceUrl ? "Source post: " + brief.sourceUrl + "." : "",
  ];
  return {
    path: "/v1/jobs",
    title: String(brief.payerName + " contract bounty").slice(0, 160),
    description: lines.filter(Boolean).join(" "),
    tags: ["clanksmith", "bounty"],
    maxSlots: 1,
  };
}

function jobUrl(jobId) {
  return "https://market.near.ai/jobs/" + jobId;
}

export function marketFor(env, fetchImpl) {
  const mode = listingMode(env);
  return createMarket({
    config: {
      base: (env.AGENT_MARKET_BASE || "https://market.near.ai").replace(/\/$/, ""),
      buyerKey: env.AGENT_MARKET_BUYER_KEY || "",
      agentToken: env.AGENT_MARKET_AGENT_TOKEN || "",
      dryRun: mode !== "live",
    },
    dryRun: mode !== "live",
    fetchImpl,
  });
}

export async function createListing({ brief, mode, market, inbox, env = {}, now = Date.now() }) {
  const amounts = (brief?.amounts || []).map((row) => row.amount + " " + row.currency);
  const base = {
    sourcePostId: brief?.sourcePostId || "",
    payerName: brief?.payerName || "",
    payerKind: brief?.payerKind || "",
    amounts,
    dryRun: mode !== "live",
    sent: false,
    replayed: false,
    jobId: "",
    url: "",
    reason: "",
  };
  if (!brief?.explicit) return { ...base, reason: "incomplete" };
  if (mode === "off") return { ...base, reason: "off" };
  const existing = inbox?.getListing ? await inbox.getListing(brief.sourcePostId) : null;
  if (existing?.jobId) return { ...base, ...existing, replayed: true, dryRun: existing.dryRun !== false };
  if (mode === "live") {
    // Competition create escrows USDC from the buyer key. Do not send that for a program bounty.
    const reason = liveListingBlock(brief, env) || "market-create-would-spend-buyer-balance";
    return { ...base, dryRun: false, reason };
  }
  const spec = marketBody(brief);
  const { path, ...payload } = spec;
  if (market?.post) await market.post(path, payload, "buyer");
  const jobId = "dry-run-" + brief.sourcePostId;
  const record = {
    sourcePostId: brief.sourcePostId,
    sourceUrl: brief.sourceUrl || "",
    jobId,
    url: jobUrl(jobId),
    payerName: brief.payerName,
    payerKind: brief.payerKind,
    amounts,
    dryRun: true,
    createdAt: now,
  };
  const saved = inbox?.saveListing ? await inbox.saveListing(record) : { record, replayed: false };
  return { ...base, ...saved.record, replayed: Boolean(saved.replayed), dryRun: true, sent: false };
}
