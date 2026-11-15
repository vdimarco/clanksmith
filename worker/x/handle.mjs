// /x/webhook answers the CRC and accepts signed X deliveries.
// /x/review lists messages a person should read. X_REPLY_MODE defaults to off.
import { normalizeWebhook } from "./events.mjs";
import { HOURLY_REPLY_LIMIT } from "./inbox.mjs";
import { BOT_USER_ID, decide } from "./policy.mjs";
import { deliverReply } from "./send.mjs";
import { crcResponseToken, sameSecret, verifyWebhookSignature } from "./sign.mjs";

const MAX_BODY = 262144;

export function replyMode(env) {
  const mode = String(env?.X_REPLY_MODE || "off").trim().toLowerCase();
  if (mode === "live" || mode === "dry-run") return mode;
  return "off";
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

  for (const event of normalizeWebhook(body, botId)) {
    const decision = decide(event);
    if (decision.action === "ignore") {
      await inbox.remember({ id: event.id, now });
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
        }
      }
      continue;
    }
    if (mode === "dry-run") {
      console.log(JSON.stringify({ event: "x.reply", mode: "dry-run", id: event.id, text: decision.text }));
      continue;
    }
    try {
      await deliverReply({
        kind: event.kind === "dm" ? "dm" : "post",
        text: decision.text,
        replyTo: event.id,
        participantId: event.participantId,
        env,
        fetchImpl: deps.fetchImpl,
        nonce: deps.nonce,
        timestamp: deps.timestamp,
        tokenProvider,
      });
      console.log(JSON.stringify({ event: "x.reply", mode: "live", id: event.id }));
    } catch (error) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 0;
      console.log(JSON.stringify({ event: "x.reply.fail", id: event.id, status }));
      // A 400 is a local refusal (bad id). Keep the claim so X does not retry it forever.
      if (!status || status === 400) continue;
      await inbox.release(event.id);
      return json({ error: "delivery failed" }, status);
    }
  }
  return json({ ok: true });
}
