// Posts a reply as @clanksmith. OAuth 2.0 user token when it is set, otherwise OAuth 1.0a.
// Errors name the HTTP status only. They do not include the response body or any secret.
import { assertBot, oauthHeader } from "../../x/reply.mjs";

const TWEETS = "https://api.x.com/2/tweets";

function numericId(id, label) {
  if (!/^\d{1,20}$/.test(String(id || ""))) {
    const error = new Error("bad " + label + " id");
    error.status = 400;
    throw error;
  }
}

export async function deliverReply({ kind, text, replyTo, participantId, env, fetchImpl = globalThis.fetch, nonce, timestamp, tokenProvider }) {
  assertBot(env.X_BOT_USERNAME || "clanksmith");
  const bot = { ...env, X_BOT_USERNAME: env.X_BOT_USERNAME || "clanksmith" };
  let url;
  let body;
  if (kind === "dm") {
    numericId(participantId, "participant");
    url = "https://api.x.com/2/dm_conversations/with/" + participantId + "/messages";
    body = { text };
  } else {
    numericId(replyTo, "reply");
    url = TWEETS;
    body = { text, reply: { in_reply_to_tweet_id: String(replyTo) } };
  }
  const headers = { "content-type": "application/json" };
  const post = async (authorization) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { ...headers, authorization },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    return { res, payload };
  };
  let bearer = null;
  if (tokenProvider) bearer = await tokenProvider();
  else if (bot.X_OAUTH2_USER_TOKEN) bearer = bot.X_OAUTH2_USER_TOKEN;
  if (bearer) {
    let sent = await post("Bearer " + bearer);
    if (sent.res.status === 401 && tokenProvider) {
      const next = await tokenProvider({ force: true, unacceptable: bearer });
      if (next && next !== bearer) sent = await post("Bearer " + next);
    }
    if (!sent.res.ok) {
      const error = new Error("X API " + (sent.res.status || "error"));
      error.status = sent.res.status || 502;
      throw error;
    }
    return { id: sent.payload?.data?.id || sent.payload?.data?.dm_event_id || null };
  }
  const missing = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"].filter((name) => !bot[name]);
  if (missing.length) {
    const error = new Error("live X reply needs user credentials: " + missing.join(", "));
    error.status = 503;
    throw error;
  }
  headers.authorization = oauthHeader({
    method: "POST",
    url,
    consumerKey: bot.X_API_KEY,
    consumerSecret: bot.X_API_SECRET,
    token: bot.X_ACCESS_TOKEN,
    tokenSecret: bot.X_ACCESS_TOKEN_SECRET,
    nonce: nonce || crypto.randomUUID().replace(/-/g, ""),
    timestamp: timestamp || Math.floor(Date.now() / 1000),
  });
  const sent = await post(headers.authorization);
  if (!sent.res.ok) {
    const error = new Error("X API " + (sent.res.status || "error"));
    error.status = sent.res.status || 502;
    throw error;
  }
  return { id: sent.payload?.data?.id || sent.payload?.data?.dm_event_id || null };
}
