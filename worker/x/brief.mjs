// Reads the post a tag points at and drafts a short reply from what it already says.
// The post text is data. Nothing in it is executed.

const MONEY = /(\d+(?:\.\d+)?)\s*(ETH|USD|USDC|NEAR)\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const REPO = /github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i;

export function pointsAtReference(text) {
  const bare = String(text || "")
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!bare) return false;
  return /\b(?:check|see|look)(?:\s+out|\s+at)?\s+(?:the\s+|this\s+|that\s+)?(?:above|post|tweet|one)\b/.test(bare)
    || /\b(?:the post above|this post|that post|quoted post|check this out)\b/.test(bare);
}

function amountsIn(text) {
  const rows = [];
  for (const match of String(text || "").matchAll(MONEY)) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 48);
    let tier = "";
    if (/high[- ]impact/i.test(after)) tier = "high";
    else if (/medium/i.test(after)) tier = "medium";
    else if (/\blow\b/i.test(after)) tier = "low";
    rows.push({ amount: match[1], currency: match[2].toUpperCase(), tier });
  }
  return rows;
}

function payerName(text) {
  const named = String(text || "").match(/\b([A-Z][A-Za-z0-9]+)'s\s+(?:\w+\s+){0,4}bounty\b/);
  if (named) return named[1];
  const pays = String(text || "").match(/\b([A-Z][A-Za-z0-9]+)\s+pays\s+\d/);
  return pays ? pays[1] : "";
}

function taskOf(text) {
  const value = String(text || "");
  if (/\bbounty\b/i.test(value) && /\bcontracts?\b/i.test(value)) return "contract bounty";
  if (/\bbounty\b/i.test(value)) return "bounty";
  const work = value.match(/\b(?:make|build|design|write|audit|review|fix|summarize)\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?([a-z0-9]+(?:\s+(?!for\b|by\b|before\b|at\b)[a-z0-9]+){0,4})/i);
  return work ? work[1].trim() : "";
}

function deliverableOf(text) {
  if (!/hardhat\s+poc/i.test(text || "")) return "";
  return /against\s+master/i.test(text) ? "Hardhat PoC against master" : "Hardhat PoC";
}

function ownJob(text) {
  return amountsIn(text).length > 0 || Boolean(taskOf(text));
}

function thin(text) {
  const bare = String(text || "").replace(/@[A-Za-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
  return bare.split(" ").filter(Boolean).length < 8 && !ownJob(text);
}

export function readBrief(event) {
  const mention = String(event?.text || "");
  const quote = String(event?.quotedText || "");
  const parent = String(event?.parentText || "");
  let via = "mention";
  let text = mention;
  let sourcePostId = String(event?.id || "");
  let sourceUsername = String(event?.username || "");
  const pointed = pointsAtReference(mention);
  if (quote && (pointed || event?.isQuote || thin(mention))) {
    via = "quote";
    text = quote;
    sourcePostId = String(event?.quotedId || "");
    sourceUsername = String(event?.quotedUsername || "");
  } else if (parent && (pointed || (thin(mention) && (amountsIn(parent).length > 0 || /\bbounty\b/i.test(parent))))) {
    via = "parent";
    text = parent;
    sourcePostId = String(event?.parentId || "");
    sourceUsername = String(event?.parentUsername || "");
  }
  const amounts = amountsIn(text);
  const named = payerName(text);
  const tagger = String(event?.username || "").replace(/^@/, "");
  const program = /\bbounty\b/i.test(text) || EMAIL.test(text);
  const payerKind = named && named.toLowerCase() !== tagger.toLowerCase() ? "third-party" : "tagger";
  const task = taskOf(text);
  const email = (text.match(EMAIL) || [])[0] || "";
  const deliverable = deliverableOf(text);
  const repoMatch = text.match(REPO);
  const repo = repoMatch ? repoMatch[0].replace(/[),.]+$/, "") : "";
  const missing = [];
  if (!task) missing.push("task");
  if (!amounts.length) missing.push("budget");
  if (!program && !/\b(?:by|before|deadline|friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow)\b/i.test(text)) {
    missing.push("deadline");
  }
  let ask = "";
  if (missing.includes("budget") && task) ask = "budget";
  else if (missing.includes("deadline") && task && amounts.length) ask = "deadline";
  else if (missing.includes("task")) ask = "task";
  return {
    via,
    text,
    sourcePostId,
    sourceUsername,
    sourceUrl: sourcePostId ? "https://x.com/" + (sourceUsername || "i") + "/status/" + sourcePostId : "",
    tagger,
    payerName: named || (payerKind === "tagger" ? tagger : ""),
    payerKind: named && named.toLowerCase() !== tagger.toLowerCase() ? "third-party" : "tagger",
    amounts,
    task,
    email,
    deliverable,
    repo,
    program,
    explicit: Boolean(task) && amounts.length > 0,
    missing,
    ask,
  };
}

function tierSentence(brief) {
  const high = brief.amounts.find((row) => row.tier === "high");
  const medium = brief.amounts.find((row) => row.tier === "medium");
  const who = brief.payerName || "The poster";
  if (high && medium) {
    return who + " pays " + high.amount + " " + high.currency + " for a high-impact bug and " + medium.amount + " " + medium.currency + " for a medium one.";
  }
  const row = brief.amounts[0];
  if (!row) return "";
  const work = brief.task ? " for the " + brief.task : "";
  return who + " set " + row.amount + " " + row.currency + work + ".";
}

function fit(parts) {
  const text = parts.filter(Boolean).join(" ").replace(/[\u2014\u2013]/g, ", ").replace(/\s+/g, " ").trim();
  if (text.length <= 280) return text;
  const url = parts.find((part) => /^https:\/\/market\.near\.ai\/jobs\//.test(part));
  const kept = parts.filter((part) => part && part !== url && !part.startsWith("Agents can bid here:"));
  const head = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!url) return head.slice(0, 279).replace(/\s+\S*$/, "") + ".";
  const room = 280 - (url.length + 1);
  const short = head.length <= room ? head : head.slice(0, room).replace(/\s+\S*$/, "").trim();
  return (short + " " + url).trim();
}

export function draftReply(brief, { url = "" } = {}) {
  if (!brief?.task && brief?.ask === "task") {
    return "Happy to help. What should agents do, and what budget comes with it?";
  }
  if (brief?.program && brief.explicit && brief.payerKind === "third-party") {
    const pay = tierSentence(brief);
    const submit = brief.deliverable && brief.email
      ? "Email a " + brief.deliverable + " to " + brief.email + "."
      : "";
    const link = url ? "Agents can bid here: " + url : "";
    return fit(["This one is already spelled out.", pay, submit, link]);
  }
  if (brief?.ask === "budget") {
    return "A " + brief.task + " is a clear job. What budget should agents bid against?";
  }
  if (brief?.ask === "deadline") {
    const row = brief.amounts[0];
    return "A " + brief.task + " at the " + row.amount + " " + row.currency + " you set is a clear job. What day should it be done?";
  }
  const pay = tierSentence(brief);
  const link = url ? "Agents can bid here: " + url : "Agents can bid on that.";
  return fit([pay, link]);
}
