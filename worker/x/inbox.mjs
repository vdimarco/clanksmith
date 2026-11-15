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

export async function readListing(storage, sourcePostId) {
  const row = await storage.get("listing:" + sourcePostId);
  return row ? { ...row } : null;
}

export async function storeListing(storage, record) {
  return transact(storage, async (tx) => {
    const key = "listing:" + record.sourcePostId;
    const existing = await tx.get(key);
    if (existing?.jobId) return { record: { ...existing }, replayed: true };
    const saved = { ...record };
    await tx.put(key, saved);
    return { record: saved, replayed: false };
  });
}

export async function readBoardJob(storage, sourcePostId) {
  const row = await storage.get("boardjob:" + sourcePostId);
  return row ? { ...row } : null;
}

export async function listBoardJobs(storage) {
  const listed = await storage.list({ prefix: "boardjob:" });
  return [...listed.values()].map((row) => ({ ...row }));
}

export async function allowSubmit(storage, key, now, limit = 5) {
  const hour = Math.floor(Number(now) / 3_600_000);
  return transact(storage, async (tx) => {
    const bucket = "rate:" + hour + ":" + key;
    const count = Number(await tx.get(bucket) || 0);
    if (count >= limit) return false;
    await tx.put(bucket, count + 1);
    return true;
  });
}

export async function readSubmission(storage, id) {
  const row = await storage.get("submission:" + id);
  return row ? { ...row } : null;
}

export async function storeSubmission(storage, record) {
  return transact(storage, async (tx) => {
    await tx.put("submission:" + record.id, record);
    const index = (await tx.get("submission-index")) || [];
    if (!index.includes(record.id)) await tx.put("submission-index", [record.id, ...index].slice(0, 200));
  });
}

export async function listSubmissionIds(storage) {
  return (await storage.get("submission-index")) || [];
}

export async function readSubmissionKey(storage, key) {
  const id = await storage.get("submit-key:" + key);
  if (!id) return null;
  return readSubmission(storage, id);
}

export async function storeSubmissionKey(storage, key, id) {
  await storage.put("submit-key:" + key, id);
}

export async function storeBoardJob(storage, job) {
  return transact(storage, async (tx) => {
    const key = "boardjob:" + job.sourcePostId;
    const existing = await tx.get(key);
    if (existing?.id) return { job: { ...existing }, replayed: true };
    const saved = { ...job };
    await tx.put(key, saved);
    return { job: saved, replayed: false };
  });
}

function memoryStorage() {
  const map = new Map();
  const storage = {
    async get(key) { return map.has(key) ? map.get(key) : undefined; },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async list(options = {}) {
      const prefix = options.prefix || "";
      const out = new Map();
      for (const [key, value] of map) {
        if (String(key).startsWith(prefix)) out.set(key, value);
      }
      return out;
    },
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
    getListing: (sourcePostId) => readListing(storage, sourcePostId),
    saveListing: (record) => storeListing(storage, record),
    getBoardJob: (sourcePostId) => readBoardJob(storage, sourcePostId),
    listBoardJobs: () => listBoardJobs(storage),
    saveBoardJob: (job) => storeBoardJob(storage, job),
    allowSubmit: (key, now) => allowSubmit(storage, key, now),
    saveSubmission: (record) => storeSubmission(storage, record),
    getSubmission: (id) => readSubmission(storage, id),
    listSubmissionIds: () => listSubmissionIds(storage),
    getSubmissionKey: (key) => readSubmissionKey(storage, key),
    saveSubmissionKey: (key, id) => storeSubmissionKey(storage, key, id),
  };
}
