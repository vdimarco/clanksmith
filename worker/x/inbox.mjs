// Dedupe, hourly cap, and the human review list.
// The Durable Object passes its storage. Tests pass an in-memory storage with the same methods.

export const HOURLY_REPLY_LIMIT = 30;
const REVIEW_LIMIT = 50;

function hourKey(now) {
  return "hour:" + Math.floor(Number(now) / 3_600_000);
}

async function transact(storage, run) {
  if (typeof storage.transaction === "function") return storage.transaction((tx) => run(tx));
  return run(storage);
}

export async function claimReply(storage, { id, now, limit = HOURLY_REPLY_LIMIT }) {
  return transact(storage, async (tx) => {
    const seenKey = "seen:" + id;
    if (await tx.get(seenKey)) return { ok: false, reason: "duplicate" };
    const bucket = hourKey(now);
    const count = Number(await tx.get(bucket) || 0);
    if (count >= limit) return { ok: false, reason: "rate" };
    await tx.put(seenKey, { now, bucket, counted: true });
    await tx.put(bucket, count + 1);
    return { ok: true };
  });
}

export async function releaseClaim(storage, id) {
  return transact(storage, async (tx) => {
    const seenKey = "seen:" + id;
    const seen = await tx.get(seenKey);
    if (!seen) return;
    await tx.delete(seenKey);
    if (seen.counted && seen.bucket) {
      const count = Number(await tx.get(seen.bucket) || 0);
      await tx.put(seen.bucket, Math.max(0, count - 1));
    }
  });
}

export async function remember(storage, { id, now }) {
  return transact(storage, async (tx) => {
    const seenKey = "seen:" + id;
    if (await tx.get(seenKey)) return { fresh: false };
    await tx.put(seenKey, { now, counted: false });
    return { fresh: true };
  });
}

export async function addReview(storage, item) {
  return transact(storage, async (tx) => {
    const items = (await tx.get("reviews")) || [];
    if (items.some((row) => row.id === item.id && row.reason === item.reason)) return;
    const text = String(item.text || "").slice(0, 500);
    const next = [{ ...item, text }, ...items].slice(0, REVIEW_LIMIT);
    await tx.put("reviews", next);
  });
}

export async function listReviews(storage) {
  const items = (await storage.get("reviews")) || [];
  return items.map((item) => ({ ...item }));
}

function memoryStorage() {
  const map = new Map();
  const storage = {
    async get(key) { return map.has(key) ? map.get(key) : undefined; },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async transaction(run) { return run(storage); },
  };
  return storage;
}

export function createMemoryInbox() {
  const storage = memoryStorage();
  return {
    claim: (opts) => claimReply(storage, opts),
    release: (id) => releaseClaim(storage, id),
    remember: (opts) => remember(storage, opts),
    review: (item) => addReview(storage, item),
    reviews: () => listReviews(storage),
  };
}
