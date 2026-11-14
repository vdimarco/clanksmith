// Market competitions become Clanksmith bounties when they carry the tag,
// the site, or a clanksmith-proof fence. Other board rows are ignored.
import { parseProof } from "./proof.mjs";
import { publicError } from "./config.mjs";

const CLOSED = new Set(["settled", "refunded", "cancelled", "canceled", "closed", "completed"]);

export function doName(jobId) {
  const cleaned = String(jobId || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
  return cleaned || "job";
}

export function moneyString(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function normalizeJob(row) {
  if (!row || typeof row !== "object") return null;
  const jobId = row.jobId || row.job_id || row.id;
  if (!jobId) return null;
  const description = String(row.description || row.brief || "");
  const tags = Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [];
  const proof = parseProof(description);
  return {
    jobId: String(jobId),
    title: String(row.title || "Untitled bounty").slice(0, 160),
    reward: moneyString(row.budgetAmount || row.budget_amount || row.poolAmount || row.pool_amount || 0),
    currency: String(row.budgetToken || row.budget_token || row.poolToken || row.token || "USDC"),
    deadline: row.entriesCloseAt || row.entries_close_at || row.deadline || null,
    description,
    tags,
    kind: String(row.jobKind || row.job_kind || row.kind || "competition"),
    state: String(row.state || row.status || "open"),
    proof,
    proofSummary: proof?.summary || firstLine(description),
  };
}

function firstLine(text) {
  const line = String(text).split("\n").map((part) => part.trim()).find(Boolean) || "No proof check summary.";
  return line.slice(0, 240);
}

export function isClanksmith(job) {
  const tags = job.tags.map((tag) => tag.toLowerCase());
  if (tags.includes("clanksmith")) return true;
  const description = job.description.toLowerCase();
  return description.includes("clanksmith.com") || description.includes("clanksmith-proof");
}

export function isOpen(job, now) {
  if (job.kind && job.kind !== "competition") return false;
  if (CLOSED.has(job.state.toLowerCase())) return false;
  if (job.deadline && Number.isFinite(Date.parse(job.deadline)) && Date.parse(job.deadline) < Date.parse(now)) return false;
  return true;
}

export function publicJob(job, { full = false } = {}) {
  const base = {
    jobId: job.jobId,
    title: job.title,
    reward: job.reward,
    currency: job.currency,
    deadline: job.deadline,
    proofSummary: job.proofSummary,
  };
  if (!full) return base;
  return {
    ...base,
    description: job.description,
    tags: job.tags,
    state: job.state,
    open: job.open,
    proof: job.proof || null,
    acceptance: acceptanceText(job),
  };
}

export function acceptanceText(job) {
  const min = job.proof?.minScore ?? 80;
  return [
    "Clanksmith runs the proof check above before it sends anything to NEAR AI Agent Market.",
    `A score under ${min} is not forwarded.`,
    "Only the highest passing submission is forwarded. The market allows one entry per builder, and Clanksmith is that builder.",
    "The market judge can still split the pool when another builder also scores 80 or higher.",
    "A person approves any Clanksmith payout. This server does not move funds.",
  ].join(" ");
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.jobs)) return body.jobs;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

export async function loadBoard(market) {
  try {
    const body = await market.get("/v1/jobs/board?kind=competition&limit=50", "agent");
    return { ok: true, jobs: rowsOf(body).map(normalizeJob).filter(Boolean) };
  } catch (err) {
    return { ok: false, jobs: [], error: `Market board read failed (${err.status || "error"}). ${publicError(err)}` };
  }
}

export async function loadJob(market, jobId) {
  const board = await loadBoard(market);
  const found = board.jobs.find((job) => job.jobId === jobId);
  if (found) return { ok: true, job: found, boardError: board.ok ? null : board.error };
  if (!board.ok) return { ok: false, error: board.error };
  try {
    const body = await market.get(`/v1/jobs/${encodeURIComponent(jobId)}`, "agent");
    const job = normalizeJob(body?.job || body);
    if (!job) return { ok: false, error: "The market did not return that job." };
    return { ok: true, job };
  } catch (err) {
    return { ok: false, error: `Job read failed (${err.status || "error"}). ${publicError(err)}` };
  }
}
