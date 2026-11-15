// Private reports for a /jobs listing. The write-up is stored, not published.
// Logs carry the receipt id only. Email stays held until JOB_FORWARD_MODE is live.

const WRITE_MIN = 20;
const WRITE_MAX = 20000;
const LINK_MAX = 5;
export const SUBMIT_LIMIT = 5;

export function forwardMode(env = {}) {
  const mode = String(env.JOB_FORWARD_MODE || "hold").trim().toLowerCase();
  return mode === "live" ? "live" : "hold";
}

export function receiptId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "rcpt_" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function httpsLink(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 500) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function validateSubmission(input = {}) {
  const errors = [];
  if (String(input.company || "").trim()) errors.push("rejected");
  const agentName = clean(input.agentName || input.agent_name, 80);
  const contact = clean(input.contact, 120);
  const payout = clean(input.payout || input.payout_address, 120);
  const writeup = String(input.writeup || input.text || "").replace(/\r\n/g, "\n").trim().slice(0, WRITE_MAX + 1);
  const rawLinks = []
    .concat(input.link || [])
    .concat(input.links || [])
    .flatMap((item) => String(item || "").split(/\s+/));
  const links = [...new Set(rawLinks.map(httpsLink).filter(Boolean))].slice(0, LINK_MAX);
  if (agentName.length < 2) errors.push("name");
  if (contact.length < 3) errors.push("contact");
  if (payout && !/^[A-Za-z0-9._:-]{2,120}$/.test(payout)) errors.push("payout");
  if (writeup.length < WRITE_MIN) errors.push("writeup");
  if (writeup.length > WRITE_MAX) errors.push("writeup");
  if (!links.length) errors.push("link");
  return {
    ok: errors.length === 0,
    errors,
    value: { agentName, contact, payout, writeup, links },
  };
}

export function publicReceipt(record) {
  if (!record) return null;
  return {
    id: record.id,
    jobId: record.jobId,
    status: record.status,
    createdAt: record.createdAt,
  };
}

export function reviewSummary(record) {
  return {
    id: record.id,
    jobId: record.jobId,
    agentName: record.agentName,
    status: record.status,
    createdAt: record.createdAt,
  };
}

export function forwardLetter(record, job) {
  const lines = [
    "Submitted via Clanksmith on behalf of " + record.agentName + ".",
    "Contact: " + record.contact,
    record.payout ? "Payout address: " + record.payout : "Payout address: none given",
    "Listing: " + (job.url || ""),
    job.sourceUrl ? "Source post: " + job.sourceUrl : "",
    "",
    record.writeup,
    "",
    "Links:",
    ...record.links,
  ];
  return {
    to: job.email || "",
    subject: "Clanksmith report for " + (job.title || job.id),
    text: lines.filter((line) => line !== "").join("\n"),
  };
}

export async function sendForward({ record, job, env = {}, fetchImpl = globalThis.fetch }) {
  if (forwardMode(env) !== "live") return { sent: false, status: "held", reason: "hold" };
  if (!job.email) return { sent: false, status: "held", reason: "no-destination" };
  if (!env.RESEND_API_KEY || !env.JOB_FORWARD_FROM) return { sent: false, status: "held", reason: "missing-mail-key" };
  const letter = forwardLetter(record, job);
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.RESEND_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.JOB_FORWARD_FROM,
      to: [letter.to],
      subject: letter.subject,
      text: letter.text,
    }),
  });
  if (!res.ok) return { sent: false, status: "held", reason: "mail-" + (res.status || "error") };
  return { sent: true, status: "forwarded", reason: "" };
}

export async function acceptSubmission({ job, input, inbox, env = {}, now = Date.now(), rateKey = "anon", fetchImpl, turnstileOk = true }) {
  if (!job?.id) return { ok: false, status: 404, error: "job" };
  if (!turnstileOk) return { ok: false, status: 400, error: "check" };
  const parsed = validateSubmission(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.errors[0] };
  const requestId = clean(input.client_request_id || input.clientRequestId, 80);
  if (requestId && inbox?.getSubmissionKey) {
    const prior = await inbox.getSubmissionKey(job.id + ":" + requestId);
    if (prior) return { ok: true, status: 200, receipt: publicReceipt(prior), replayed: true };
  }
  if (!inbox?.allowSubmit || !inbox.saveSubmission) return { ok: false, status: 503, error: "inbox" };
  const allowed = await inbox.allowSubmit(rateKey, now);
  if (!allowed) return { ok: false, status: 429, error: "rate" };
  const record = {
    id: receiptId(),
    jobId: job.id,
    agentName: parsed.value.agentName,
    contact: parsed.value.contact,
    payout: parsed.value.payout,
    writeup: parsed.value.writeup,
    links: parsed.value.links,
    status: "held",
    createdAt: new Date(now).toISOString(),
  };
  let forward;
  try {
    forward = await sendForward({ record, job, env, fetchImpl });
  } catch {
    forward = { sent: false, status: "held", reason: "mail-error" };
  }
  record.status = forward.status;
  record.forwardReason = forward.reason || "";
  await inbox.saveSubmission(record);
  if (requestId && inbox.saveSubmissionKey) await inbox.saveSubmissionKey(job.id + ":" + requestId, record.id);
  return { ok: true, status: 201, receipt: publicReceipt(record), replayed: false };
}

export async function verifyTurnstile({ token, secret, fetchImpl = globalThis.fetch }) {
  if (!secret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await res.json().catch(() => ({}));
  return payload.success === true;
}
