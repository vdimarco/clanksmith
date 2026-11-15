// /x/webhook answers the CRC and accepts signed X deliveries.
// /x/review lists messages a person should read. X_REPLY_MODE defaults to off.
import { composeReply } from "./compose.mjs";
import { normalizeWebhook } from "./events.mjs";
import { HOURLY_REPLY_LIMIT } from "./inbox.mjs";
import { chatNotice, postNotify, replyNotice } from "./notify.mjs";
import { BOT_USER_ID, decide } from "./policy.mjs";
import { deliverReply } from "./send.mjs";
import { crcResponseToken, sameSecret, verifyWebhookSignature } from "./sign.mjs";

const MAX_BODY = 262144;
const SILENT = new Set(["self", "retweet", "empty", "spam"]);

export function replyMode(env) {
  const mode = String(env?.X_REPLY_MODE || "off").trim().toLowerCase();
  if (mode === "live" || mode === "dry-run") return mode;
  return "off";
}

function replyLog(mode, event, composed) {
  const line = { event: "x.reply", mode, id: event.id, source: composed.source, text: composed.text };
  if (composed.model) line.model = composed.model;
  if (Array.isArray(composed.fallback) && composed.fallback.length) line.fallback = composed.fallback;
  return line;
}

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
}

async function readLimited(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    const error = new Error("too large");
    error.status = 413;
    throw error;
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel();
      const error = new Error("too large");
      error.status = 413;
      throw error;
    }
    chunks.push(value);
  }
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

async function inboxFor(env, deps) {
  if (deps.inbox) return deps.inbox;
  if (!env.X_INBOX) return null;
  const { durableInbox } = await import("./object.mjs");
  return durableInbox(env.X_INBOX);
}

async function reviewResponse(request, env, deps) {
  if (request.method !== "GET") return json({ error: "method" }, 405);
  if (!env.X_REVIEW_TOKEN) return json({ error: "not found" }, 404);
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!(await sameSecret(provided, env.X_REVIEW_TOKEN))) return json({ error: "unauthorized" }, 401);
  const inbox = await inboxFor(env, deps);
  if (!inbox) return json({ error: "inbox is not configured" }, 503);
  return json({ items: await inbox.reviews() });
}

async function crcResponse(url, env) {
  const token = url.searchParams.get("crc_token");
  if (!token) return json({ error: "crc_token required" }, 400);
  const secret = env.X_CLIENT_SECRET || env.X_API_SECRET;
  if (!secret) return json({ error: "webhook secret is not configured" }, 503);
  return json({ response_token: await crcResponseToken(token, secret) });
}

export async function handleX(request, env, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/x/review") return reviewResponse(request, env, deps);
  if (url.pathname !== "/x/webhook") return json({ error: "not found" }, 404);
  if (request.method === "GET") return crcResponse(url, env);
  if (request.method !== "POST") return json({ error: "method" }, 405);

  let raw;
  try {
    raw = await readLimited(request);
  } catch (error) {
    return json({ error: "too large" }, error.status || 413);
  }
  const signed = await verifyWebhookSignature({
    raw,
    headers: request.headers,
    clientSecret: env.X_CLIENT_SECRET || "",
    consumerSecret: env.X_API_SECRET || "",
  });
  if (!signed) return json({ error: "unauthorized" }, 401);

  const mode = replyMode(env);
  if (mode === "off") {
    console.log(JSON.stringify({ event: "x.webhook", mode: "off" }));
    return json({ ok: true, mode: "off" });
  }

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const inbox = await inboxFor(env, deps);
  if (!inbox) return json({ error: "inbox is not configured" }, 503);
  const tokenProvider = deps.tokenProvider
    || (typeof inbox.accessToken === "function" ? (opts) => inbox.accessToken(opts) : null);
  const now = deps.now ? deps.now() : Date.now();
  const botId = BOT_USER_ID;
  const pending = [];
  const notices = [];

  for (const event of normalizeWebhook(body, botId)) {
    const decision = decide(event);
    if (decision.action === "ignore") {
      const fresh = await inbox.remember({ id: event.id, now });
      if (fresh.fresh && !SILENT.has(decision.reason)) {
        notices.push(replyNotice({ event, outcome: "skipped", reason: decision.reason }));
      }
      continue;
    }
    if (decision.action === "review") {
      const fresh = await inbox.remember({ id: event.id, now });
      if (fresh.fresh) {
        await inbox.review({
          id: event.id,
          kind: event.kind,
          authorId: event.authorId,
          reason: decision.reason,
          text: String(event.text || "").slice(0, 500),
          at: now,
        });
        console.log(JSON.stringify({ event: "x.review", id: event.id, reason: decision.reason }));
        notices.push(event.kind === "chat" ? chatNotice(event) : replyNotice({ event, outcome: "held", reason: decision.reason }));
      }
      continue;
    }
    const claim = await inbox.claim({ id: event.id, now, limit: HOURLY_REPLY_LIMIT });
    if (!claim.ok) {
      if (claim.reason === "rate") {
        const fresh = await inbox.remember({ id: event.id, now });
        if (fresh.fresh) {
          await inbox.review({
            id: event.id,
            kind: event.kind,
            authorId: event.authorId,
            reason: "rate",
            text: String(event.text || "").slice(0, 500),
            at: now,
          });
          console.log(JSON.stringify({ event: "x.review", id: event.id, reason: "rate" }));
          notices.push(replyNotice({ event, outcome: "skipped", reason: "rate" }));
        }
      }
      continue;
    }
    // The id is claimed before the 200, so a webhook retry cannot post twice
    // while the model call is still running.
    pending.push({ event, decision });
  }
  const work = (async () => {
    for (const notice of notices) await postNotify(env, notice, { fetchImpl: deps.notifyFetch });
    await publishReplies(pending, { mode, env, deps, tokenProvider });
  })();
  if (deps.ctx && typeof deps.ctx.waitUntil === "function") {
    deps.ctx.waitUntil(work);
    return json({ ok: true });
  }
  await work;
  return json({ ok: true });
}

async function publishReplies(pending, { mode, env, deps, tokenProvider }) {
  for (const { event, decision } of pending) {
    let composed = { text: decision.text, source: "template" };
    try {
      composed = await composeReply({
        event,
        reason: decision.reason,
        template: decision.text,
        env,
        fetchImpl: deps.llmFetch,
      });
    } catch {
      composed = { text: decision.text, source: "template" };
    }
    if (mode === "dry-run") {
      console.log(JSON.stringify(replyLog("dry-run", event, composed)));
      await postNotify(env, replyNotice({ event, composed, outcome: "dry-run", reason: decision.reason }), { fetchImpl: deps.notifyFetch });
      continue;
    }
    try {
      await postReply(event, composed.text, env, deps, tokenProvider);
      console.log(JSON.stringify(replyLog("live", event, composed)));
      await postNotify(env, replyNotice({ event, composed, outcome: "sent", reason: decision.reason }), { fetchImpl: deps.notifyFetch });
    } catch (error) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 0;
      if (status && status !== 400) {
        try {
          await postReply(event, composed.text, env, deps, tokenProvider);
          console.log(JSON.stringify(replyLog("live", event, composed)));
          await postNotify(env, replyNotice({ event, composed, outcome: "sent", reason: decision.reason }), { fetchImpl: deps.notifyFetch });
          continue;
        } catch (retryError) {
          const retryStatus = retryError.status >= 400 && retryError.status <= 599 ? retryError.status : status;
          console.log(JSON.stringify({ event: "x.reply.fail", id: event.id, status: retryStatus }));
          await postNotify(env, replyNotice({ event, composed, outcome: "failed", reason: "x-api-" + retryStatus }), { fetchImpl: deps.notifyFetch });
          continue;
        }
      }
      console.log(JSON.stringify({ event: "x.reply.fail", id: event.id, status }));
      await postNotify(env, replyNotice({ event, composed, outcome: "failed", reason: status ? "x-api-" + status : "send-failed" }), { fetchImpl: deps.notifyFetch });
    }
  }
}

function postReply(event, text, env, deps, tokenProvider) {
  return deliverReply({
    kind: event.kind === "dm" ? "dm" : "post",
    text,
    replyTo: event.id,
    participantId: event.participantId,
    env,
    fetchImpl: deps.fetchImpl,
    nonce: deps.nonce,
    timestamp: deps.timestamp,
    tokenProvider,
  });
}
