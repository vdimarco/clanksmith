// Fills in a parent or quoted post when the webhook did not include its text.
// The bearer token is a request header only. It is never logged.

import { pointsAtReference } from "./brief.mjs";

function expand(tweet) {
  if (!tweet) return "";
  let text = String(tweet.note_tweet?.text || tweet.text || "");
  for (const url of tweet.entities?.urls || []) {
    if (url?.url && url?.expanded_url) text = text.split(url.url).join(url.expanded_url);
  }
  return text.slice(0, 2000);
}

export async function readToken(env, tokenProvider) {
  if (typeof tokenProvider === "function") {
    try {
      const token = await tokenProvider();
      if (token) return String(token);
    } catch {
      return "";
    }
  }
  return String(env?.X_BEARER_TOKEN || env?.X_OAUTH2_USER_TOKEN || "");
}

export async function hydrateEvent(event, { fetchImpl, token } = {}) {
  if (!event) return event;
  const needsParent = event.parentId && !event.parentText && pointsAtReference(event.text);
  const needsQuote = event.quotedId && !event.quotedText && (event.isQuote || pointsAtReference(event.text));
  const id = needsParent ? String(event.parentId) : needsQuote ? String(event.quotedId) : "";
  if (!id || !token || typeof fetchImpl !== "function") return event;
  let res;
  try {
    res = await fetchImpl(
      "https://api.x.com/2/tweets/" + encodeURIComponent(id) + "?tweet.fields=text,author_id,entities,note_tweet&expansions=author_id&user.fields=username",
      { headers: { authorization: "Bearer " + token } },
    );
  } catch {
    return event;
  }
  if (!res?.ok || typeof res.json !== "function") return event;
  const payload = await res.json().catch(() => null);
  const text = expand(payload?.data);
  if (!text) return event;
  const authorId = payload?.data?.author_id;
  const username = (payload?.includes?.users || []).find((user) => String(user.id) === String(authorId))?.username || "";
  if (needsParent) return { ...event, parentText: text, parentUsername: username || event.parentUsername || "" };
  return { ...event, quotedText: text, quotedUsername: username || event.quotedUsername || "" };
}
