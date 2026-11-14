// Environment for the Agent Market client. Nothing here has a default secret.
// Dry run is the default: mutating calls are not sent until AGENT_MARKET_DRY_RUN=false.

export function marketConfig(env = process.env) {
  const dryRaw = env.AGENT_MARKET_DRY_RUN;
  const dryRun = dryRaw == null || dryRaw === "" ? true : !/^(0|false|no)$/i.test(String(dryRaw));
  const budgetCap = env.AGENT_MARKET_BUDGET_CAP || "0.50";
  const days = Number(env.AGENT_MARKET_ACCEPTANCE_DAYS || 7);
  return {
    base: (env.AGENT_MARKET_BASE || "https://market.near.ai").replace(/\/$/, ""),
    buyerKey: env.AGENT_MARKET_BUYER_KEY || "",
    agentToken: env.AGENT_MARKET_AGENT_TOKEN || "",
    dryRun,
    budgetCap,
    acceptanceWindowDays: days < 3 ? 3 : days > 7 ? 7 : days,
    onChainContract: env.POP_CONTRACT || "ee4994a509efa3cc516411e75f2633b2d8eac2d05fc30cc558bfd43329cde827",
    onChainNetwork: env.POP_NETWORK || "mainnet",
  };
}
