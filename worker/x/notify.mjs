// Wakes Vaughn's chat when a reply is drafted or an encrypted X Chat arrives.
// The URL and the Authorization value are secrets. This module never logs them.

export const NOTIFY_TIMEOUT_MS = 5000;

export function authorHandle(event) {
  const name = String(event?.username || "").replace(/^@/, "").trim();
  return name ? "@" + name : null;
}

export function notifySource(composed) {
  if (!composed || composed.source !== "llm") return "template";
  const model = String(composed.model || "");
  if (/grok/i.test(model)) return "grok";
  if (/haiku/i.test(model)) return "haiku";
  return "template";
}

export function replyNotice({ event, composed, outcome, reason }) {
  return {
    type: "reply",
    kind: event?.kind === "dm" ? "dm" : "post",
    id: String(event?.id || ""),
    author: authorHandle(event),
    author_id: String(event?.authorId || ""),
    their_text: String(event?.text || "").slice(0, 500),
    reply_text: composed?.text ? String(composed.text) : null,
    source: notifySource(composed),
    model: composed?.model || null,
    outcome,
    reason: reason ? String(reason).slice(0, 80) : null,
  };
}

export function chatNotice(event) {
  const body = {
    type: "chat",
    sender_id: String(event?.participantId || event?.authorId || ""),
    event_id: String(event?.id || ""),
  };
  if (event?.conversationId) body.conversation_id = String(event.conversationId);
  return body;
}

export async function postNotify(env, body, { fetchImpl = globalThis.fetch, timeoutMs = NOTIFY_TIMEOUT_MS } = {}) {
  const url = env?.CHAT_WAKE_URL;
  const auth = env?.CHAT_WAKE_AUTH;
  if (!url || !auth) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = 0;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: auth,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = res.status || 0;
  } catch {
    status = 0;
  } finally {
    clearTimeout(timer);
    console.log(JSON.stringify({ event: "x.notify", status }));
  }
}
