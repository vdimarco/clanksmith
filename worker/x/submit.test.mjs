import assert from "node:assert/strict";
import test from "node:test";
import { seedJobs } from "./boardjob.mjs";
import { createMemoryInbox } from "./inbox.mjs";
import { SUBMIT_LIMIT, acceptSubmission, forwardLetter, publicReceipt, validateSubmission } from "./submit.mjs";

const job = () => ({ ...seedJobs()[0], email: "bugs@aktionariat.com" });

const input = {
  agentName: "Ink",
  contact: "ink@example.com",
  payout: "ink.near",
  writeup: "A short note for the program about the public bounty.",
  link: "https://gist.github.com/example/abc",
};

test("a report needs a name, a contact, a write-up, and an https link", () => {
  assert.equal(validateSubmission(input).ok, true);
  assert.equal(validateSubmission({ ...input, link: "http://gist.github.com/a" }).ok, false);
  assert.equal(validateSubmission({ ...input, writeup: "too short" }).ok, false);
  assert.equal(validateSubmission({ ...input, company: "spam" }).ok, false);
});

test("the default path holds the report and does not email it", async () => {
  const inbox = createMemoryInbox();
  let called = 0;
  const result = await acceptSubmission({
    job: job(),
    input,
    inbox,
    env: { RESEND_API_KEY: "re_secret_value" },
    now: Date.parse("2026-11-15T18:00:00.000Z"),
    rateKey: "one",
    fetchImpl: async () => { called += 1; throw new Error("sent"); },
  });
  assert.equal(called, 0);
  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, "held");
  assert.match(result.receipt.id, /^rcpt_[0-9a-f]{32}$/);
  const stored = await inbox.getSubmission(result.receipt.id);
  assert.equal(stored.writeup, input.writeup);
  assert.equal(publicReceipt(stored).writeup, undefined);
  assert.equal(JSON.stringify(result).includes("re_secret_value"), false);
  assert.equal(JSON.stringify(result).includes(input.writeup), false);
});

test("live forwarding emails the program on behalf of the named submitter", async () => {
  const inbox = createMemoryInbox();
  let seen = null;
  const result = await acceptSubmission({
    job: job(),
    input,
    inbox,
    env: { JOB_FORWARD_MODE: "live", RESEND_API_KEY: "re_secret_value", JOB_FORWARD_FROM: "reports@clanksmith.com" },
    now: Date.parse("2026-11-15T18:05:00.000Z"),
    rateKey: "two",
    fetchImpl: async (url, opts) => {
      seen = { url, opts };
      return { ok: true, status: 200, json: async () => ({ id: "mail" }) };
    },
  });
  assert.equal(result.receipt.status, "forwarded");
  assert.equal(seen.url, "https://api.resend.com/emails");
  assert.equal(seen.opts.headers.authorization, "Bearer re_secret_value");
  const body = JSON.parse(seen.opts.body);
  assert.deepEqual(body.to, ["bugs@aktionariat.com"]);
  assert.match(body.text, /via Clanksmith on behalf of Ink/);
  assert.match(body.text, /ink@example.com/);
  assert.equal(body.text.includes("re_secret_value"), false);
  const letter = forwardLetter({ ...input, links: [input.link] }, job());
  assert.match(letter.subject, /Aktionariat/);
});

test("live mode without a mail key stays held", async () => {
  const inbox = createMemoryInbox();
  let called = 0;
  const result = await acceptSubmission({
    job: job(),
    input,
    inbox,
    env: { JOB_FORWARD_MODE: "live" },
    now: Date.parse("2026-11-15T18:06:00.000Z"),
    rateKey: "three",
    fetchImpl: async () => { called += 1; throw new Error("sent"); },
  });
  assert.equal(called, 0);
  assert.equal(result.receipt.status, "held");
  const stored = await inbox.getSubmission(result.receipt.id);
  assert.equal(stored.forwardReason, "missing-mail-key");
});

test("the sixth report in an hour is refused and a retry uses the same receipt", async () => {
  const inbox = createMemoryInbox();
  const now = Date.parse("2026-11-15T19:00:00.000Z");
  assert.equal(SUBMIT_LIMIT, 5);
  for (let i = 0; i < SUBMIT_LIMIT; i += 1) {
    const result = await acceptSubmission({
      job: job(),
      input: { ...input, client_request_id: "try-" + i },
      inbox,
      now,
      rateKey: "crowd",
      fetchImpl: async () => { throw new Error("sent"); },
    });
    assert.equal(result.ok, true, String(i));
  }
  const blocked = await acceptSubmission({
    job: job(),
    input,
    inbox,
    now,
    rateKey: "crowd",
    fetchImpl: async () => { throw new Error("sent"); },
  });
  assert.equal(blocked.status, 429);
  const first = await acceptSubmission({
    job: job(),
    input: { ...input, client_request_id: "same" },
    inbox,
    now: now + 10,
    rateKey: "other",
    fetchImpl: async () => { throw new Error("sent"); },
  });
  const again = await acceptSubmission({
    job: job(),
    input: { ...input, writeup: "A different note that should not replace the first report.", client_request_id: "same" },
    inbox,
    now: now + 20,
    rateKey: "other",
    fetchImpl: async () => { throw new Error("sent"); },
  });
  assert.equal(again.replayed, true);
  assert.equal(again.receipt.id, first.receipt.id);
});
