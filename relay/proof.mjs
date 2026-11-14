// Each Clanksmith bounty carries a machine-readable proof check in its description.
// The pre-judge runs that check locally. The market never sees a failing submission.

const FENCE = /```clanksmith-proof\s*([\s\S]*?)```/i;

export function parseProof(description) {
  const text = String(description ?? "");
  const fence = text.match(FENCE);
  if (!fence) return null;
  let spec;
  try { spec = JSON.parse(fence[1]); } catch { return null; }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const checks = Array.isArray(spec.checks) ? spec.checks.map(normalizeCheck).filter(Boolean) : [];
  if (!checks.length) return null;
  const minScore = clampScore(spec.minScore ?? spec.min_score ?? 80);
  const summary = String(spec.summary || "Proof check").slice(0, 240);
  return { summary, minScore, checks };
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 80;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function normalizeCheck(row) {
  if (!row || typeof row !== "object") return null;
  const type = String(row.type || "");
  const points = Number(row.points);
  if (!Number.isFinite(points) || points <= 0) return null;
  const id = String(row.id || type).slice(0, 40);
  if (type === "json_object") {
    const required = Array.isArray(row.required) ? row.required.map((k) => String(k)).slice(0, 20) : [];
    return { id, type, points, required };
  }
  if (type === "min_length") {
    const min = Number(row.min);
    if (!Number.isFinite(min) || min < 1) return null;
    return { id, type, points, min: Math.min(min, 100000) };
  }
  if (type === "has_url") return { id, type, points };
  if (type === "includes") {
    const value = String(row.value || "");
    if (!value || value.length > 200) return null;
    return { id, type, points, value };
  }
  if (type === "file_link") return { id, type, points };
  return null;
}

function extractJson(text) {
  const fence = String(text).match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : String(text).trim();
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function hasHttpUrl(value) {
  return /https?:\/\/[^\s)]+/i.test(String(value || ""));
}

function runCheck(check, submission) {
  const text = String(submission.text || "");
  if (check.type === "json_object") {
    const data = extractJson(text);
    if (!data) return { ...check, pass: false, reason: "The work needs one JSON object." };
    const missing = check.required.filter((key) => {
      const value = data[key];
      return value == null || (typeof value === "string" && value.trim() === "");
    });
    if (missing.length) return { ...check, pass: false, reason: `JSON is missing ${missing.join(", ")}.` };
    return { ...check, pass: true, reason: "JSON object has the required fields." };
  }
  if (check.type === "min_length") {
    const pass = text.trim().length >= check.min;
    return { ...check, pass, reason: pass ? "Length is enough." : `Work is shorter than ${check.min} characters.` };
  }
  if (check.type === "has_url") {
    const pass = hasHttpUrl(text) || (submission.urls || []).some(hasHttpUrl);
    return { ...check, pass, reason: pass ? "A link is present." : "Add an http or https link." };
  }
  if (check.type === "includes") {
    const pass = text.includes(check.value);
    return { ...check, pass, reason: pass ? `Includes ${check.value}.` : `The work must include ${check.value}.` };
  }
  if (check.type === "file_link") {
    const pass = (submission.files || []).some(hasHttpUrl);
    return { ...check, pass, reason: pass ? "A file link is present." : "Add a file link." };
  }
  return { ...check, pass: false, reason: "Unknown check." };
}

export function scoreSubmission(proof, submission) {
  if (!proof) {
    return {
      pass: false,
      score: 0,
      reason: "This bounty has no machine-readable proof check, so nothing can be forwarded.",
      checks: [],
      summary: "No machine-readable proof check.",
    };
  }
  const checks = proof.checks.map((check) => runCheck(check, submission));
  const total = checks.reduce((sum, check) => sum + check.points, 0) || 1;
  const earned = checks.reduce((sum, check) => sum + (check.pass ? check.points : 0), 0);
  const score = Math.round((earned / total) * 100);
  const pass = score >= proof.minScore;
  const failed = checks.filter((check) => !check.pass).map((check) => check.reason);
  return {
    pass,
    score,
    reason: pass ? "Proof check passed." : failed.join(" "),
    checks: checks.map(({ id, pass: ok, points, reason }) => ({ id, pass: ok, points, reason })),
    summary: proof.summary,
    minScore: proof.minScore,
  };
}
