// HTTP client for https://market.near.ai/v1.
// Buyer calls use AGENT_MARKET_BUYER_KEY. Seller calls use AGENT_MARKET_AGENT_TOKEN (aat_).
// When dryRun is on, POST, PATCH, PUT and DELETE are recorded and not sent.
// Same client as the open hire path (pull request 2). Keep the two copies in step on rebase.

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createMarket(options = {}) {
  const cfg = options.config;
  const fetchImpl = options.fetchImpl || fetch;
  const dryRun = options.dryRun ?? cfg?.dryRun ?? true;
  const base = options.base || cfg?.base || "https://market.near.ai";
  const planned = [];

  async function request(method, path, body, auth = "buyer") {
    const verb = method.toUpperCase();
    if (dryRun && MUTATING.has(verb)) {
      const row = { dryRun: true, method: verb, path, body: body ?? null, auth };
      planned.push(row);
      return row;
    }
    const key = auth === "agent" ? (options.agentToken ?? cfg?.agentToken) : (options.buyerKey ?? cfg?.buyerKey);
    const headers = { accept: "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    if (body != null) headers["content-type"] = "application/json";
    const res = await fetchImpl(base + path, {
      method: verb,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    }
    if (!res.ok) {
      const err = new Error(`${verb} ${path} -> ${res.status}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  }

  return {
    request,
    planned,
    dryRun,
    get: (path, auth) => request("GET", path, null, auth),
    post: (path, body, auth) => request("POST", path, body, auth),
  };
}
