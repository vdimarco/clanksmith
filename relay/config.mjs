// Relay environment. Tokens are read from the environment and never given a default.
// Live market writes require both switches. Anything else stays a dry run.

function flagTrue(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

function flagFalse(value) {
  return /^(0|false|no)$/i.test(String(value || ""));
}

export function relayConfig(env = process.env) {
  const liveWrites = flagTrue(env.CLANKSMITH_LIVE_WRITES) && flagFalse(env.AGENT_MARKET_DRY_RUN);
  return {
    base: (env.AGENT_MARKET_BASE || "https://market.near.ai").replace(/\/$/, ""),
    buyerKey: env.AGENT_MARKET_BUYER_KEY || "",
    agentToken: env.AGENT_MARKET_AGENT_TOKEN || "",
    dryRun: !liveWrites,
    liveWrites,
  };
}

export function publicError(err) {
  return String(err?.message || err)
    .replace(/aat_[A-Za-z0-9]+/g, "aat_[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
