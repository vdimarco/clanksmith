import assert from "node:assert/strict";
import test from "node:test";
import { HOURLY_REPLY_LIMIT, createMemoryInbox } from "./inbox.mjs";

test("the same post or DM id is claimed once", async () => {
  const inbox = createMemoryInbox();
  const now = Date.parse("2026-11-15T00:10:00.000Z");
  const first = await inbox.claim({ id: "post-1", now });
  const second = await inbox.claim({ id: "post-1", now: now + 5 });
  const other = await inbox.claim({ id: "dm-9", now: now + 6 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "duplicate");
  assert.equal(other.ok, true);
});

test("the 31st reply in an hour is refused and the next hour is allowed", async () => {
  const inbox = createMemoryInbox();
  const start = Date.parse("2026-11-15T01:00:00.000Z");
  assert.equal(HOURLY_REPLY_LIMIT, 30);
  for (let i = 0; i < HOURLY_REPLY_LIMIT; i++) {
    const result = await inbox.claim({ id: "p" + i, now: start + i });
    assert.equal(result.ok, true, String(i));
  }
  const blocked = await inbox.claim({ id: "overflow", now: start + HOURLY_REPLY_LIMIT });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "rate");
  const later = await inbox.claim({ id: "next-hour", now: start + 3_600_000 });
  assert.equal(later.ok, true);
});

test("releasing a failed send frees the id and the hourly slot", async () => {
  const inbox = createMemoryInbox();
  const now = Date.parse("2026-11-15T02:00:00.000Z");
  for (let i = 0; i < HOURLY_REPLY_LIMIT - 1; i++) {
    assert.equal((await inbox.claim({ id: "k" + i, now })).ok, true);
  }
  assert.equal((await inbox.claim({ id: "last", now })).ok, true);
  assert.equal((await inbox.claim({ id: "extra", now })).reason, "rate");
  await inbox.release("last");
  const again = await inbox.claim({ id: "last", now });
  assert.equal(again.ok, true);
  assert.equal((await inbox.claim({ id: "extra", now })).reason, "rate");
});

test("a review is stored once and can be listed", async () => {
  const inbox = createMemoryInbox();
  const item = { id: "dm-3", kind: "dm", authorId: "9", reason: "refund", text: "please refund", at: 1 };
  assert.equal((await inbox.remember({ id: "dm-3", now: 1 })).fresh, true);
  await inbox.review(item);
  assert.equal((await inbox.remember({ id: "dm-3", now: 2 })).fresh, false);
  await inbox.review(item);
  const items = await inbox.reviews();
  assert.equal(items.length, 1);
  assert.equal(items[0].reason, "refund");
  assert.equal(items[0].text, "please refund");
});
