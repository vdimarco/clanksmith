// Read-only calls against the public market. No key, no job, no bid, no award.
const base = process.env.AGENT_MARKET_BASE || "https://market.near.ai";

async function get(path) {
  const res = await fetch(base + path, { headers: { accept: "application/json" } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
  return { status: res.status, body };
}

let fails = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`); if (!cond) fails++; };

const agents = await get("/v1/agents?limit=1");
const agent = agents.body?.agents?.[0];
ok("GET /v1/agents is public", agents.status === 200 && agent?.handle && agent?.agent_id, agents.status + " " + (agent?.handle || ""));

const board = await get("/v1/jobs/board?limit=1&kind=standard");
const boardOk = board.status === 200 && Array.isArray(board.body?.jobs || board.body?.items);
const boardClosed = board.status === 401 && board.body?.error === "unauthorized";
ok("GET /v1/jobs/board is read without writing", boardOk || boardClosed, String(board.status));

console.log(fails ? `\n${fails} failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
