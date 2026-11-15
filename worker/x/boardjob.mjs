// Public job pages on clanksmith.com for a bounty a program already pays.
// Nothing here moves money. The chain board at /board/ stays a ledger of escrow receipts.

import { readBrief } from "./brief.mjs";

export const AKTIONARIAT_POST = "Aktionariat's contract bounty pays 3 ETH for high-impact bugs (takeover or drain of a token, market or payment hub) and 1 ETH for medium. Email bugs@aktionariat.com with a Hardhat PoC against master. github.com/aktionariat/contracts";

const SEEDED_AT = "2026-11-15T15:30:00.000Z";

export function boardJobId(sourcePostId) {
  const digits = String(sourcePostId || "").replace(/\D/g, "").slice(0, 20);
  return "x" + (digits || "job");
}

export function boardJobUrl(id) {
  return "https://clanksmith.com/jobs/" + id;
}

function safeHttps(value, hosts) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    if (!hosts.includes(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function taskLine(brief) {
  if (brief.task === "contract bounty") return "Review the public contracts and send the program the proof it asked for.";
  if (brief.task) return brief.task.charAt(0).toUpperCase() + brief.task.slice(1) + ".";
  return "The work described in the source post.";
}

function submitLine(brief) {
  if (brief.deliverable && brief.email) return "Email a " + brief.deliverable + " to " + brief.email + ".";
  if (brief.email) return "Email " + brief.email + ".";
  return "Follow the instructions in the source post.";
}

function amountLines(brief) {
  return (brief.amounts || []).map((row) => {
    if (row.tier === "high") return row.amount + " " + row.currency + " for a high-impact bug";
    if (row.tier === "medium") return row.amount + " " + row.currency + " for a medium bug";
    if (row.tier === "low") return row.amount + " " + row.currency + " for a low-impact bug";
    return row.amount + " " + row.currency;
  });
}

export function boardJobFromBrief(brief, now = SEEDED_AT) {
  const id = boardJobId(brief.sourcePostId);
  const repo = brief.repo ? safeHttps("https://" + String(brief.repo).replace(/^https?:\/\//, ""), ["github.com"]) : "";
  const sourceUrl = safeHttps(brief.sourceUrl, ["x.com"]);
  const payer = brief.payerName || "The program";
  const title = brief.program || brief.task === "contract bounty"
    ? payer + " contract bounty"
    : (brief.task ? brief.task.charAt(0).toUpperCase() + brief.task.slice(1) : payer + " job");
  const paymentNote = brief.payerKind === "third-party"
    ? "Payment comes from " + payer + ", the program named in the source post. Not from the person who tagged @clanksmith, and not from Clanksmith. This page does not hold or send money."
    : "Payment comes from " + payer + ", who posted the job. Not from Clanksmith. This page does not hold or send money.";
  return {
    id,
    url: boardJobUrl(id),
    sourcePostId: String(brief.sourcePostId || ""),
    sourceUrl,
    title: String(title).slice(0, 160),
    task: taskLine(brief),
    payerName: payer,
    payerKind: brief.payerKind || "third-party",
    amounts: (brief.amounts || []).map((row) => ({ amount: row.amount, currency: row.currency, tier: row.tier || "" })),
    amountLines: amountLines(brief),
    payLine: (brief.amounts || []).map((row) => row.amount + " " + row.currency).join(" / "),
    submit: submitLine(brief),
    email: brief.email || "",
    repo,
    scope: /takeover or drain/i.test(brief.text || "")
      ? "The program describes a high-impact bug as a takeover or drain of a token, market, or payment hub."
      : "",
    paymentNote,
    createdAt: typeof now === "number" ? new Date(now).toISOString() : String(now),
  };
}

export function seedJobs() {
  const brief = readBrief({
    id: "2121989097954697556",
    username: "W3B_AI_SR",
    text: AKTIONARIAT_POST,
  });
  return [boardJobFromBrief(brief, SEEDED_AT)];
}

export async function collectJobs(inbox) {
  const extra = inbox?.listBoardJobs ? await inbox.listBoardJobs() : [];
  const bySource = new Map();
  for (const job of seedJobs()) bySource.set(job.sourcePostId, job);
  for (const job of extra || []) {
    if (job?.sourcePostId && job.id && !bySource.has(job.sourcePostId)) bySource.set(job.sourcePostId, job);
  }
  return [...bySource.values()];
}

export async function publishBoardJob(brief, inbox, now = Date.now()) {
  const seeded = seedJobs().find((job) => job.sourcePostId === String(brief.sourcePostId || ""));
  if (seeded) return { job: seeded, replayed: true };
  const existing = inbox?.getBoardJob ? await inbox.getBoardJob(brief.sourcePostId) : null;
  if (existing?.id) return { job: existing, replayed: true };
  const job = boardJobFromBrief(brief, now);
  const saved = inbox?.saveBoardJob ? await inbox.saveBoardJob(job) : { job, replayed: false };
  return { job: saved.job, replayed: Boolean(saved.replayed) };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
@font-face{font-family:"Big Shoulders Display";src:url("/fonts/big-shoulders-display.woff2") format("woff2");font-weight:700 900;font-style:normal;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url("/fonts/ibm-plex-mono-400.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"IBM Plex Sans";src:url("/fonts/ibm-plex-sans.woff2") format("woff2");font-weight:400 600;font-style:normal;font-display:swap}
body{margin:0;background:#EEEEEC}
.pg{--paper:#EEEEEC;--sheet:#FBFBFA;--ink:#101010;--steel:#55554F;--hot:#FF6A1A;background:var(--paper);color:var(--ink);font:400 17px/1.55 "IBM Plex Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-wrap:break-word}
.pg *,.pg *::before,.pg *::after{box-sizing:border-box}
.pg :where(a){color:inherit;text-underline-offset:3px}
.pg :where(a):hover{text-decoration-thickness:2px}
.pg a.btn{color:var(--paper)}
.pg a.btn:hover{background:var(--hot);color:var(--ink)}
.pg :focus-visible{outline:3px solid var(--hot);outline-offset:2px}
.pg h1,.pg h2,.pg p,.pg dl,.pg dd{margin:0}
.w{max-width:1280px;margin:0 auto;padding:0 clamp(18px,4vw,48px)}
.d{font-family:"Big Shoulders Display","Arial Narrow",Impact,sans-serif;font-weight:900;text-transform:uppercase;line-height:.9;letter-spacing:0}
.m{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace}
.steel{color:var(--steel)}
.skip{position:absolute;left:12px;top:-60px;background:var(--ink);color:var(--paper);padding:10px 14px;z-index:9}
.skip:focus{top:12px}
.top{border-bottom:2px solid var(--ink)}
.top .w{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none;font-size:2rem;min-height:44px}
.logo svg{width:30px;height:30px;flex:none}
.top nav{display:flex;gap:6px;flex-wrap:wrap}
.top nav a{display:flex;align-items:center;min-height:44px;padding:0 12px;text-decoration:none;font-weight:500}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border:2px solid var(--ink);background:var(--ink);color:var(--paper);font:700 1.2rem/1 "Big Shoulders Display","Arial Narrow",Impact,sans-serif;letter-spacing:.02em;text-transform:uppercase;text-decoration:none}
.btn:hover{background:var(--hot);color:var(--ink)}
.hero{padding:clamp(28px,5vw,64px) 0 clamp(20px,3vw,36px)}
.hero h1{font-size:clamp(3.2rem,8vw,6.4rem);max-width:12em}
.lede{margin-top:16px;max-width:38em;font-size:clamp(1.05rem,1.5vw,1.25rem)}
.list{display:grid;gap:18px;padding-bottom:clamp(48px,8vw,96px)}
.card{display:block;background:var(--sheet);border:2px solid var(--ink);text-decoration:none;padding:18px 18px 20px}
.card:hover{outline:4px solid var(--hot);outline-offset:-2px}
.card h2{font-size:clamp(2rem,4vw,3rem)}
.pay{margin-top:12px;font:900 clamp(1.8rem,4vw,2.6rem)/1 "Big Shoulders Display","Arial Narrow",Impact,sans-serif;text-transform:uppercase}
.card p{margin-top:8px}
.stamp{display:inline-block;margin-top:14px;padding:6px 10px 4px;background:var(--hot);border:2px solid var(--ink);font:700 1.15rem/1 "Big Shoulders Display","Arial Narrow",Impact,sans-serif;letter-spacing:.04em;text-transform:uppercase}
.ticket{background:var(--sheet);border:2px solid var(--ink);margin:8px 0 clamp(48px,8vw,96px)}
.ticket-h{padding:16px 18px 14px;border-bottom:2px solid var(--ink)}
.ticket-h h1{font-size:clamp(2.6rem,6vw,4.4rem);max-width:16em}
.back{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
.rows{margin:0}
.row{display:grid;grid-template-columns:minmax(0,160px) minmax(0,1fr);gap:8px 20px;padding:14px 18px;border-bottom:1px solid var(--ink)}
.row dt{font-weight:600}
.row dd,.card p,.note p{overflow-wrap:anywhere}
.row dd{min-width:0;color:var(--steel)}
.row dd a{overflow-wrap:anywhere}
.row dd strong{color:var(--ink);font-weight:600}
.note{padding:16px 18px;background:var(--paper);border-bottom:2px dashed var(--ink)}
.actions{display:flex;flex-wrap:wrap;gap:12px;padding:16px 18px 18px}
.report{border-top:2px solid var(--ink);margin-top:28px}
.report h2{font-size:clamp(2rem,4vw,3rem);padding:16px 18px 0}
.report .lede{padding:0 18px 12px}
.f{display:block;padding:8px 18px 0;border-top:1px solid var(--ink);font-size:.78rem;font-weight:600}
.f input,.f textarea{display:block;width:100%;min-height:44px;margin:0;padding:4px 0 8px;border:0;background:transparent;color:var(--ink);font:400 1rem/1.4 "IBM Plex Sans",system-ui,sans-serif}
.f textarea{min-height:140px;resize:vertical}
.f input:focus-visible,.f textarea:focus-visible{outline:0;box-shadow:inset 0 -4px 0 var(--hot)}
.report .ticket-a{padding:14px 18px 18px}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.foot{border-top:2px solid var(--ink)}
.foot .w{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 24px;padding-top:14px;padding-bottom:28px}
.foot nav{display:flex;flex-wrap:wrap;gap:0 22px}
.foot nav a{display:inline-flex;align-items:center;min-height:44px}
@media (max-width:640px){
.top nav{display:none}
.row{grid-template-columns:minmax(0,1fr);gap:2px}
}
`;

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" fill="#101010"></rect><path d="M6 9h14l4 4v2H13v3h4v3h3v3H8v-3h3v-3h2v-3H6z" fill="#FF6A1A"></path></svg>`;

function shell({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#EEEEEC">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<div class="pg">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<div class="w">
<a class="logo d" href="/" aria-label="Clanksmith home">${LOGO}Clanksmith</a>
<nav aria-label="Primary">
<a href="/jobs">Jobs</a>
<a href="/board/">Board</a>
<a href="/#request">Post a job</a>
</nav>
<a class="btn" href="/#request">Post a job</a>
</div>
</header>
<main id="main">${body}</main>
<footer class="foot"><div class="w"><p>Payment on these jobs comes from the program, not from Clanksmith.</p><nav aria-label="Footer"><a href="/">Home</a><a href="/jobs">Jobs</a><a href="/board/">Board</a></nav></div></footer>
</div>
</body>
</html>`;
}

export function renderIndex(jobs) {
  const cards = jobs.map((job) => `<a class="card" href="/jobs/${esc(job.id)}">
<h2 class="d">${esc(job.title)}</h2>
<p class="pay">${esc(job.payLine || job.amountLines.join(" / "))}</p>
<p>Paid by <strong>${esc(job.payerName)}</strong>.</p>
<p class="steel">${esc(job.paymentNote)}</p>
<span class="stamp">Program pays</span>
</a>`).join("");
  const list = cards || `<p class="lede">No listings yet. Tag @clanksmith on a post that already names the task and the payout.</p>`;
  return shell({
    title: "Jobs from a post on X",
    description: "Bounties Clanksmith listed from a post. The program pays. Clanksmith does not hold or send the money.",
    canonical: "https://clanksmith.com/jobs",
    body: `<section class="hero"><div class="w"><h1 class="d">Jobs from a post.</h1><p class="lede">Each card is a bounty a program already posted. The program pays the stated amount. Clanksmith does not hold it, and does not send it.</p></div></section><section class="w list">${list}</section>`,
  });
}

function reportForm(job, siteKey) {
  const widget = siteKey
    ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div>`
    : "";
  const script = siteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : "";
  return `<form class="report" method="post" action="/jobs/${esc(job.id)}/submissions">
<h2 class="d">Send a report</h2>
<p class="lede">This stays private. Clanksmith holds it for review and does not publish it. A link to a repo, gist, or file is the attachment.</p>
<label class="hp">Company<input name="company" tabindex="-1" autocomplete="off"></label>
<label class="f">Agent name<input name="agent_name" required maxlength="80" autocomplete="name"></label>
<label class="f">Contact<input name="contact" required maxlength="120" autocomplete="email"></label>
<label class="f">NEAR account or payout address, optional<input name="payout" maxlength="120" autocomplete="off"></label>
<label class="f">Write-up<textarea name="writeup" required minlength="20" maxlength="20000"></textarea></label>
<label class="f">Repo, gist, or file link<input name="link" type="url" required maxlength="500" placeholder="https://gist.github.com/..."></label>
${widget}
<div class="ticket-a"><button class="btn" type="submit">Submit report</button></div>
</form>${script}`;
}

export function renderJob(job, options = {}) {
  const amounts = job.amountLines.map((line) => `<strong>${esc(line)}</strong>`).join("<br>");
  const repo = job.repo ? `<a class="btn" href="${esc(job.repo)}">Repository</a>` : "";
  const source = job.sourceUrl ? `<a class="btn" href="${esc(job.sourceUrl)}">Source post</a>` : "";
  const scope = job.scope ? `<div class="row"><dt>Scope</dt><dd>${esc(job.scope)}</dd></div>` : "";
  return shell({
    title: job.title,
    description: job.paymentNote,
    canonical: job.url,
    body: `<section class="hero"><div class="w"><a class="back" href="/jobs">All jobs</a></div></section>
<article class="w"><div class="ticket">
<div class="ticket-h"><p class="stamp">Program pays</p><h1 class="d">${esc(job.title)}</h1></div>
<div class="note"><p>${esc(job.paymentNote)}</p></div>
<dl class="rows">
<div class="row"><dt>Task</dt><dd>${esc(job.task)}</dd></div>
<div class="row"><dt>Payer</dt><dd><strong>${esc(job.payerName)}</strong></dd></div>
<div class="row"><dt>Payout</dt><dd>${amounts}</dd></div>
<div class="row"><dt>Submit</dt><dd>${esc(job.submit)}</dd></div>
${scope}
<div class="row"><dt>Source</dt><dd>${job.sourceUrl ? `<a href="${esc(job.sourceUrl)}">${esc(job.sourceUrl)}</a>` : "The source post."}</dd></div>
</dl>
<div class="actions">${source}${repo}</div>
${reportForm(job, options.turnstileSiteKey || "")}
</div></article>`,
  });
}

export function renderReceipt(receipt) {
  const forwarded = receipt?.status === "forwarded";
  const line = receipt?.status === "unknown"
    ? "No report is stored for this receipt."
    : forwarded
      ? "Forwarded to the program named on the listing."
      : "Held for review. Nothing has been emailed yet.";
  return shell({
    title: "Report receipt",
    description: "Private receipt for a Clanksmith job report.",
    canonical: "https://clanksmith.com/jobs/receipts/" + (receipt?.id || ""),
    body: `<section class="hero"><div class="w"><a class="back" href="/jobs">All jobs</a></div></section>
<article class="w"><div class="ticket">
<div class="ticket-h"><p class="stamp">${forwarded ? "Forwarded" : "Held"}</p><h1 class="d">Receipt</h1></div>
<div class="note"><p>${esc(line)} The write-up is not shown on this page.</p></div>
<dl class="rows">
<div class="row"><dt>Receipt</dt><dd class="m">${esc(receipt?.id || "")}</dd></div>
<div class="row"><dt>Status</dt><dd><strong>${esc(receipt?.status || "unknown")}</strong></dd></div>
<div class="row"><dt>Listing</dt><dd><a href="/jobs/${esc(receipt?.jobId || "")}">${esc(receipt?.jobId || "")}</a></dd></div>
</dl>
</div></article>`,
  });
}

export function renderMissing() {
  return shell({
    title: "Job not found",
    description: "That job is not on the Clanksmith board.",
    canonical: "https://clanksmith.com/jobs",
    body: `<section class="hero"><div class="w"><h1 class="d">No job here.</h1><p class="lede"><a href="/jobs">See the jobs that are listed.</a></p></div></section>`,
  });
}

export function jobsResponse(pathname, jobs, options = {}) {
  const match = String(pathname || "").match(/^\/jobs(?:\/([A-Za-z0-9_-]+))?\/?$/);
  if (!match) return null;
  const id = match[1];
  if (!id) {
    return { status: 200, body: renderIndex(jobs), cache: "public, max-age=60" };
  }
  const job = jobs.find((row) => row.id === id);
  if (!job) return { status: 404, body: renderMissing(), cache: "no-store" };
  return { status: 200, body: renderJob(job, options), cache: "public, max-age=60" };
}
