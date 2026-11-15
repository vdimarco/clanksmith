// HTTP for private job reports. Review needs the same bearer as /x/review.
// Public pages return a receipt id and a status. They do not return the write-up.

import { collectJobs } from "./boardjob.mjs";
import { renderReceipt } from "./boardjob.mjs";
import { sameSecret } from "./sign.mjs";
import { acceptSubmission, publicReceipt, reviewSummary, verifyTurnstile } from "./submit.mjs";

const MAX_BODY = 65536;

function html(body, status, cache = "no-store") {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache },
  });
}

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
}

async function readBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    const error = new Error("too large");
    error.status = 413;
    throw error;
  }
  const text = await request.text();
  if (text.length > MAX_BODY) {
    const error = new Error("too large");
    error.status = 413;
    throw error;
  }
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

async function rateKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("submit:" + ip));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wantsJson(request) {
  const type = request.headers.get("content-type") || "";
  const accept = request.headers.get("accept") || "";
  return type.includes("application/json") || accept.includes("application/json");
}

export async function handleJobSubmission(request, env, inbox) {
  const url = new URL(request.url);
  const reviewList = url.pathname === "/jobs/review" || url.pathname === "/jobs/review/";
  const reviewOne = url.pathname.match(/^\/jobs\/review\/(rcpt_[0-9a-f]{32})\/?$/);
  if (request.method === "GET" && (reviewList || reviewOne)) return reviewResponse(request, env, inbox, reviewOne?.[1] || "");

  const receipt = url.pathname.match(/^\/jobs\/receipts\/(rcpt_[0-9a-f]{32})\/?$/);
  if (request.method === "GET" && receipt) {
    const record = inbox ? await inbox.getSubmission(receipt[1]) : null;
    if (!record) return html(renderReceipt({ id: receipt[1], jobId: "", status: "unknown" }), 404);
    const pub = publicReceipt(record);
    if (wantsJson(request)) return json(pub);
    return html(renderReceipt(pub));
  }

  const post = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)\/submissions\/?$/);
  if (request.method === "POST" && post) return createResponse(request, env, inbox, post[1]);
  return null;
}

async function createResponse(request, env, inbox, jobId) {
  let input;
  try {
    input = await readBody(request);
  } catch (error) {
    return json({ ok: false, error: "too large" }, error.status || 413);
  }
  const origin = request.headers.get("origin");
  const jsonCall = wantsJson(request);
  if (!jsonCall && origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "origin" }, 403);
  const jobs = await collectJobs(inbox);
  const job = jobs.find((row) => row.id === jobId);
  const turnstileOk = await verifyTurnstile({
    token: input["cf-turnstile-response"] || input.turnstileToken || "",
    secret: env.TURNSTILE_SECRET_KEY || "",
    fetchImpl: globalThis.fetch,
  });
  const result = await acceptSubmission({
    job,
    input,
    inbox,
    env,
    rateKey: await rateKey(request),
    turnstileOk,
  });
  console.log(JSON.stringify({
    event: "job.submit",
    jobId,
    receiptId: result.receipt?.id || "",
    status: result.receipt?.status || result.error || "error",
  }));
  if (!result.ok) {
    if (jsonCall) return json({ ok: false, error: result.error }, result.status);
    return html(renderReceipt({ id: "", jobId, status: result.error === "rate" ? "limited" : "rejected" }), result.status);
  }
  if (jsonCall) return json({ ok: true, ...result.receipt }, result.status);
  return Response.redirect(new URL("/jobs/receipts/" + result.receipt.id, request.url), 303);
}

async function reviewResponse(request, env, inbox, id) {
  if (!env.X_REVIEW_TOKEN) return json({ error: "not found" }, 404);
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!(await sameSecret(provided, env.X_REVIEW_TOKEN))) return json({ error: "unauthorized" }, 401);
  if (!inbox) return json({ error: "inbox is not configured" }, 503);
  if (!id) {
    const ids = await inbox.listSubmissionIds();
    const items = [];
    for (const receipt of ids) {
      const record = await inbox.getSubmission(receipt);
      if (record) items.push(reviewSummary(record));
    }
    return json({ items });
  }
  const record = await inbox.getSubmission(id);
  if (!record) return json({ error: "not found" }, 404);
  return json({
    id: record.id,
    jobId: record.jobId,
    agentName: record.agentName,
    contact: record.contact,
    payout: record.payout,
    links: record.links,
    writeup: record.writeup,
    status: record.status,
    createdAt: record.createdAt,
  });
}
