// One-time registration for the @clanksmith X Activity webhook.
// The bearer token creates the webhook. The user token subscribes private events.
// Returned summaries never include either token.

export const WEBHOOK_URL = "https://clanksmith.com/x/webhook";
export const BOT_USER_ID = "1065743939729309697";
export const SUBSCRIPTIONS = ["post.mention.create", "post.reply.create", "dm.received", "chat.received"];

async function postJson(fetchImpl, url, token, body) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("X API " + res.status);
  return payload;
}

export async function registerWebhooks({ env, fetchImpl = globalThis.fetch, dryRun = false, webhookUrl = WEBHOOK_URL, userId = BOT_USER_ID } = {}) {
  const planned = SUBSCRIPTIONS.map((eventType) => ({ eventType, userId }));
  if (dryRun) return { dryRun: true, url: webhookUrl, webhookId: null, subscriptions: planned };
  if (!env?.X_BEARER_TOKEN) throw new Error("X_BEARER_TOKEN is required to register the webhook");

  const created = await postJson(fetchImpl, "https://api.x.com/2/webhooks", env.X_BEARER_TOKEN, { url: webhookUrl });
  const webhookId = created?.data?.id;
  if (!webhookId) throw new Error("webhook registration did not return an id");
  if (!env.X_OAUTH2_USER_TOKEN) {
    return {
      dryRun: false,
      url: webhookUrl,
      webhookId,
      subscriptions: [],
      warning: "X_OAUTH2_USER_TOKEN is required to subscribe private events",
    };
  }
  const subscriptions = [];
  for (const eventType of SUBSCRIPTIONS) {
    const result = await postJson(fetchImpl, "https://api.x.com/2/activity/subscriptions", env.X_OAUTH2_USER_TOKEN, {
      event_type: eventType,
      filter: { user_id: userId },
      webhook_id: webhookId,
    });
    subscriptions.push({ eventType, id: result?.data?.id || null });
  }
  return { dryRun: false, url: webhookUrl, webhookId, subscriptions };
}
