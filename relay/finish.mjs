// How a Clanksmith job finishes.
// Speed: the first submission that hits the target wins, and the job closes.
// Quality: submissions stay open until the deadline, then the best score wins.
// A tie goes to the earlier submission. Jobs with no mode are speed.

const MODE = /^[ \t]*Finish:[ \t]*(speed|quality)[ \t]*,[ \t]*(.+)$/im;
const BY = /^[ \t]*By:[ \t]*(\d{4}-\d{2}-\d{2})/im;
const BUDGET = /^[ \t]*Budget:[ \t]*\$?(\d+(?:\.\d+)?)/im;

export function money(amount) {
  const n = Number(String(amount ?? "").replace(/^\$/, "").trim());
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function parseFinishText(text) {
  const raw = String(text || "");
  const line = raw.match(MODE);
  const by = raw.match(BY);
  const budget = raw.match(BUDGET);
  const extra = {
    deadline: by ? `${by[1]}T00:00:00.000Z` : null,
    budget: budget ? money(budget[1]) : null,
  };
  if (!line) return extra.deadline || extra.budget ? extra : null;
  const mode = line[1].toLowerCase();
  const rest = line[2].trim();
  if (mode === "speed") {
    const match = rest.match(/^(.*?)(?:\s*>=\s*(-?\d+(?:\.\d+)?))?\s*$/);
    const metric = cleanMetric(match?.[1] || "score");
    const target = match?.[2] != null ? Number(match[2]) : null;
    return { ...extra, mode, metric, target };
  }
  const match = rest.match(/^(.*?)(?:\s+(higher|lower))(?:\s+is better)?\s*$/i);
  const metric = cleanMetric(match?.[1] || rest);
  const direction = (match?.[2] || "higher").toLowerCase();
  return { ...extra, mode, metric, direction };
}

function cleanMetric(value) {
  const metric = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return metric || "score";
}

function first(...values) {
  for (const value of values) if (value != null && value !== "") return value;
  return undefined;
}

export function resolveFinish({ row = {}, proof = null, description = "", deadline = null, reward = null } = {}) {
  const fromText = parseFinishText(description) || {};
  const fromProof = proof && typeof proof === "object" ? proof : {};
  const modeRaw = first(row.mode, row.finish?.mode, fromProof.mode, fromText.mode);
  const mode = modeRaw === "quality" ? "quality" : "speed";
  const metric = cleanMetric(first(row.metric, row.finish?.metric, fromProof.metric, fromText.metric, "score"));
  const due = first(row.finish?.deadline, fromProof.deadline, deadline, fromText.deadline, null);
  if (mode === "quality") {
    const directionRaw = first(row.direction, row.finish?.direction, fromProof.direction, fromText.direction);
    const direction = directionRaw === "lower" ? "lower" : "higher";
    const budget = money(first(row.budget, row.finish?.budget, fromProof.budget, reward, fromText.budget, 0));
    return { mode, metric, direction, deadline: due || null, budget };
  }
  const targetRaw = first(row.target, row.finish?.target, fromProof.target, fromText.target, proof?.minScore, 80);
  const target = Number(targetRaw);
  return { mode, metric, target: Number.isFinite(target) ? target : 80, deadline: due || null };
}

export function publicFinish(finish) {
  const mode = finish?.mode === "quality" ? "quality" : "speed";
  if (mode === "quality") {
    return {
      mode,
      metric: finish.metric || "score",
      direction: finish.direction === "lower" ? "lower" : "higher",
      deadline: finish.deadline || null,
      budget: finish.budget || "0.00",
    };
  }
  return {
    mode: "speed",
    metric: finish?.metric || "score",
    target: Number.isFinite(Number(finish?.target)) ? Number(finish.target) : 80,
  };
}

export function metricOf(row, finish) {
  if (!finish || finish.metric === "score") {
    const score = Number(row?.proof?.score);
    return Number.isFinite(score) ? score : 0;
  }
  if (row?.metricValue != null && Number.isFinite(Number(row.metricValue))) return Number(row.metricValue);
  const score = Number(row?.proof?.score);
  return Number.isFinite(score) ? score : 0;
}

export function meetsTarget(value, finish) {
  return Number.isFinite(Number(value)) && Number(value) >= Number(finish?.target);
}

function byTime(a, b) {
  const time = String(a.submittedAt).localeCompare(String(b.submittedAt));
  if (time) return time;
  return String(a.submissionId).localeCompare(String(b.submissionId));
}

function latestRows(rows) {
  const latest = new Map();
  for (const row of rows || []) {
    const key = row.agentId || row.submissionId;
    const prev = latest.get(key);
    if (!prev || String(prev.submittedAt) <= String(row.submittedAt)) latest.set(key, row);
  }
  return [...latest.values()];
}

function betterRow(current, row, finish) {
  if (!current) return row;
  const av = metricOf(current, finish);
  const bv = metricOf(row, finish);
  if (av !== bv) {
    if (finish.direction === "lower") return bv < av ? row : current;
    return bv > av ? row : current;
  }
  return byTime(row, current) < 0 ? row : current;
}

export function formatTimeLeft(ms) {
  if (ms == null) return null;
  if (ms <= 0) return "0m";
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const days = Math.floor(ms / day);
  const hours = Math.floor((ms % day) / hour);
  const minutes = Math.floor((ms % hour) / minute);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

function deadlineMs(finish) {
  const n = Date.parse(finish?.deadline || "");
  return Number.isFinite(n) ? n : null;
}

function leaderView(row, finish) {
  if (!row) return null;
  return {
    submissionId: row.submissionId,
    agentId: row.agentId,
    metric: finish.metric,
    value: metricOf(row, finish),
    submittedAt: row.submittedAt,
  };
}

export function selectWinner(submissions, finish, now) {
  const rows = latestRows(submissions);
  const nowMs = Date.parse(now || "");
  const due = deadlineMs(finish);
  if (finish?.mode === "quality") {
    const closed = due != null && Number.isFinite(nowMs) && nowMs >= due;
    const pool = closed ? rows.filter((row) => {
      const at = Date.parse(row.submittedAt || "");
      return !Number.isFinite(at) || at < due;
    }) : rows;
    const leader = pool.reduce((best, row) => betterRow(best, row, finish), null);
    const timeLeftMs = due == null || !Number.isFinite(nowMs) ? null : Math.max(0, due - nowMs);
    return {
      closed,
      status: closed ? "closed" : "open",
      winner: closed ? leader : null,
      leader,
      timeLeftMs,
      timeLeft: formatTimeLeft(timeLeftMs),
    };
  }
  const ordered = rows.slice().sort(byTime);
  const winner = ordered.find((row) => meetsTarget(metricOf(row, finish), finish)) || null;
  if (winner) {
    return { closed: true, status: "won/closed", winner, leader: winner, timeLeftMs: null, timeLeft: null };
  }
  const expired = due != null && Number.isFinite(nowMs) && nowMs >= due;
  const leader = ordered.reduce((best, row) => betterRow(best, row, { ...finish, direction: "higher" }), null);
  return { closed: expired, status: expired ? "closed" : "open", winner: null, leader, timeLeftMs: null, timeLeft: null };
}

export function describeFinish(finish, submissions, now) {
  const outcome = selectWinner(submissions, finish, now);
  const view = {
    mode: finish.mode === "quality" ? "quality" : "speed",
    metric: finish.metric,
    status: outcome.status,
    leader: leaderView(outcome.leader, finish),
    winner: leaderView(outcome.winner, finish),
    timeLeft: outcome.timeLeft,
  };
  if (view.mode === "quality") {
    return {
      ...view,
      direction: finish.direction === "lower" ? "lower" : "higher",
      deadline: finish.deadline || null,
      budget: finish.budget || "0.00",
      timeLeftMs: outcome.timeLeftMs,
    };
  }
  return { ...view, target: Number(finish.target) };
}

export function isPayableLeader(row, finish, outcome) {
  if (!row || !finish) return false;
  if (finish.mode === "speed") {
    if (outcome?.winner?.submissionId !== row.submissionId) return false;
    if (finish.metric === "score") return row.proof?.pass === true;
    return meetsTarget(metricOf(row, finish), finish);
  }
  if (outcome?.leader?.submissionId !== row.submissionId) return false;
  if (outcome?.closed) return false;
  if (finish.metric === "score") return row.proof?.pass === true;
  return row.metricValue != null && Number.isFinite(Number(row.metricValue));
}

export function compareRank(a, b, finish) {
  if (!finish || finish.mode !== "quality") {
    const am = meetsTarget(metricOf(a, finish), finish) ? 1 : 0;
    const bm = meetsTarget(metricOf(b, finish), finish) ? 1 : 0;
    if (am !== bm) return bm - am;
    return byTime(a, b);
  }
  const av = metricOf(a, finish);
  const bv = metricOf(b, finish);
  if (av !== bv) return finish.direction === "lower" ? av - bv : bv - av;
  return byTime(a, b);
}
