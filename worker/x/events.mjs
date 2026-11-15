// Turns an X Activity API delivery, or a legacy Account Activity body, into a short list.
// Encrypted chat ciphertext is dropped here. The policy only needs to know that it arrived.

function postFrom(payload, eventType) {
  const refs = Array.isArray(payload.referenced_tweets) ? payload.referenced_tweets : [];
  const text = String(payload.full_text || payload.text || "");
  return {
    kind: "post",
    id: String(payload.id_str || payload.id || ""),
    authorId: String(payload.author_id || payload.user?.id_str || payload.user?.id || ""),
    text,
    isRetweet: eventType === "post.repost.create" || Boolean(payload.retweeted_status) || refs.some((item) => item.type === "retweeted") || /^RT @/i.test(text),
    isQuote: eventType === "post.quote.create" || Boolean(payload.quoted_status) || refs.some((item) => item.type === "quoted"),
    encrypted: false,
    eventType,
    participantId: null,
  };
}

function dmsFrom(list, eventType) {
  const events = [];
  for (const dm of list || []) {
    if (dm.type && dm.type !== "message_create") continue;
    const sender = dm.message_create?.sender_id;
    events.push({
      kind: "dm",
      id: String(dm.id || ""),
      authorId: String(sender || ""),
      text: String(dm.message_create?.message_data?.text || ""),
      isRetweet: false,
      isQuote: false,
      encrypted: false,
      eventType,
      participantId: sender ? String(sender) : null,
    });
  }
  return events;
}

function fromActivity(data) {
  const type = String(data.event_type || "");
  const payload = data.payload || {};
  if (type.startsWith("chat.")) {
    return [{
      kind: "chat",
      id: String(payload.id || data.event_uuid || ""),
      authorId: String(payload.sender_id || ""),
      text: "",
      isRetweet: false,
      isQuote: false,
      encrypted: true,
      eventType: type,
      participantId: payload.sender_id ? String(payload.sender_id) : null,
    }];
  }
  if (type.startsWith("dm.") || Array.isArray(payload.direct_message_events)) {
    return dmsFrom(payload.direct_message_events, type || "dm");
  }
  if (type.startsWith("post.")) return [postFrom(payload, type)];
  return [];
}

export function normalizeWebhook(body, botUserId) {
  if (!body || typeof body !== "object") return [];
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
  if (data?.event_type) {
    const owner = data.filter?.user_id;
    if (owner && String(owner) !== String(botUserId)) return [];
    return fromActivity(data).filter((event) => event.id);
  }
  if (body.for_user_id && String(body.for_user_id) !== String(botUserId)) return [];
  const events = [];
  for (const tweet of body.tweet_create_events || []) events.push(postFrom(legacyTweet(tweet), "tweet_create_events"));
  events.push(...dmsFrom(body.direct_message_events, "direct_message_events"));
  return events.filter((event) => event.id);
}

function legacyTweet(tweet) {
  return {
    id: tweet.id_str || tweet.id,
    author_id: tweet.user?.id_str || tweet.user?.id,
    text: tweet.full_text || tweet.text || "",
    retweeted_status: tweet.retweeted_status,
    quoted_status: tweet.quoted_status,
    referenced_tweets: tweet.retweeted_status ? [{ type: "retweeted", id: String(tweet.retweeted_status.id_str || "") }] : [],
  };
}
