// The same delivery checks the NEAR contract runs, on the JSON inside a market deliverable.
// Paint contrast uses the integer table in lin.json, copied from contract/src/checks.rs.
import { readFileSync } from "node:fs";

const LIN = JSON.parse(readFileSync(new URL("./lin.json", import.meta.url)));

export function extractDelivery(markdown) {
  const text = String(markdown ?? "");
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text.trim();
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "deliverable JSON must be an object" };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "deliverable has no JSON object" };
  }
}

function fail(reason) { return { pass: false, reason }; }
function pass(reason) { return { pass: true, reason }; }

function cell(v) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  if (!Number.isInteger(v[0]) || !Number.isInteger(v[1])) return null;
  return [v[0], v[1]];
}

function mapCheck(spec, d) {
  const n = spec.rooms || 0;
  const cols = spec.cols || 0;
  const rows = spec.rows || 0;
  if (!Array.isArray(d.rooms)) return fail("no rooms");
  const rooms = [];
  for (const r of d.rooms) {
    const c = cell(r);
    if (!c) return fail("bad room");
    if (c[0] < 0 || c[1] < 0 || c[0] >= cols || c[1] >= rows) return fail("room outside the grid");
    if (rooms.some((x) => x[0] === c[0] && x[1] === c[1])) return fail("room twice");
    rooms.push(c);
  }
  if (rooms.length !== n) return fail(`${rooms.length} rooms, asked ${n}`);
  const idx = (c) => rooms.findIndex((x) => x[0] === c[0] && x[1] === c[1]);
  const adj = rooms.map(() => []);
  if (!Array.isArray(d.links)) return fail("no links");
  for (const l of d.links) {
    if (!Array.isArray(l) || l.length !== 2) return fail("bad link");
    const a = cell(l[0]);
    const b = cell(l[1]);
    if (!a || !b) return fail("bad link");
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return fail("link between rooms that do not touch");
    const i = idx(a);
    const j = idx(b);
    if (i < 0 || j < 0) return fail("link to a missing room");
    adj[i].push(j);
    adj[j].push(i);
  }
  const entry = cell(d.entry);
  const entryI = entry && idx(entry);
  if (entryI == null || entryI < 0) return fail("no entry");
  const seen = rooms.map(() => false);
  const queue = [entryI];
  seen[entryI] = true;
  while (queue.length) {
    const i = queue.pop();
    for (const j of adj[i]) if (!seen[j]) { seen[j] = true; queue.push(j); }
  }
  const cut = seen.filter((s) => !s).length;
  if (cut === 1) return fail("room cut off");
  if (cut > 1) return fail(`${cut} rooms cut off`);
  const exit = cell(d.exit);
  if (!exit || idx(exit) < 0) return fail("no exit");
  return pass(`all ${n} rooms reach the entry, exit found`);
}

function rosterCheck(spec, d) {
  const lo = spec.lo || 0;
  const hi = spec.hi || 0;
  const size = spec.size || 0;
  if (!Array.isArray(d.critters)) return fail("no critters");
  if (d.critters.length !== size) return fail(`${d.critters.length} critters, asked ${size}`);
  let sum = 0;
  for (const c of d.critters) {
    const t = c?.threat;
    if (!(t >= 1 && t <= 5)) return fail("threat must be 1 to 5");
    const name = c?.name;
    if (typeof name !== "string" || name.length < 1 || name.length > 40) return fail("bad critter name");
    sum += t;
  }
  if (sum < lo) return fail(`threat ${sum}, too tame (${lo} to ${hi})`);
  if (sum > hi) return fail(`threat ${sum}, too deadly (${lo} to ${hi})`);
  return pass(`threat ${sum}, inside ${lo} to ${hi}`);
}

const SCALES = {
  "C major": [0, 2, 4, 5, 7, 9, 11],
  "A minor": [9, 11, 0, 2, 4, 5, 7],
  "G major": [7, 9, 11, 0, 2, 4, 6],
  "E minor": [4, 6, 7, 9, 11, 0, 2],
};

function tuneCheck(spec, d) {
  const bars = spec.bars || 0;
  const key = spec.key || "";
  const sc = SCALES[key];
  if (!sc) return fail("unknown key");
  if (d.bars !== bars) return fail(`${d.bars ?? 0} bars, asked ${bars}`);
  if (!Array.isArray(d.notes)) return fail("no notes");
  if (d.notes.length !== bars * 4) return fail(`${d.notes.length} notes, asked ${bars * 4}`);
  let off = 0;
  for (const n of d.notes) {
    if (!(typeof n === "number" && n >= 0 && n <= 127)) return fail("notes must be MIDI 0 to 127");
    if (!sc.includes(n % 12)) off += 1;
  }
  if (off > 0) return fail(`${off} notes out of ${key}`);
  return pass(`${bars} bars, every note in ${key}`);
}

function hexColor(v) {
  if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v)) return null;
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
}
function lum(c) {
  return Math.floor((2126 * LIN[c[0]] + 7152 * LIN[c[1]] + 722 * LIN[c[2]]) / 10000);
}
export function contrastX100(a, b) {
  const x = lum(a);
  const y = lum(b);
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  return Math.floor((hi + 50000) * 100 / (lo + 50000));
}
function paintCheck(spec, d) {
  const need = spec.contrast_x100 || 300;
  const floor = hexColor(d.floor);
  const wall = hexColor(d.wall);
  if (!floor || !wall || !hexColor(d.accent)) return fail("colours must be #rrggbb");
  const c = contrastX100(floor, wall);
  const ratio = `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}:1`;
  if (c < need) return fail(`floor to wall contrast ${ratio}, under ${Math.floor(need / 100)}.${String(need % 100).padStart(2, "0")}:1`);
  return pass(`floor to wall contrast ${ratio}`);
}

export function checkDelivery(kind, spec, data) {
  if (kind === "map") return mapCheck(spec, data);
  if (kind === "roster") return rosterCheck(spec, data);
  if (kind === "tune") return tuneCheck(spec, data);
  if (kind === "paint") return paintCheck(spec, data);
  return fail("unknown kind");
}

export function checkMarkdown(kind, spec, markdown) {
  const got = extractDelivery(markdown);
  if (!got.ok) return { pass: false, reason: got.reason, data: null };
  const verdict = checkDelivery(kind, spec, got.data);
  return { ...verdict, data: got.data };
}
