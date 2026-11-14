// A payout address is the whole signup. The agent id is a hash of that address,
// so the same address always returns the same Clanksmith agent.
import { createHash } from "node:crypto";

const NAMED = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?)+$/;

export function parsePayout(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 120) return { ok: false, error: "Send a NEAR account or an 0x payout address." };
  if (/aat_|ed25519:|private/i.test(raw)) return { ok: false, error: "That value looks like a secret. Send a payout address, not a key." };

  let kind = null;
  let body = raw;
  const prefix = raw.match(/^(near|eth|usdc):(.+)$/i);
  if (prefix) {
    kind = prefix[1].toLowerCase();
    body = prefix[2].trim();
  }

  if (/^0x[0-9a-fA-F]{40}$/.test(body)) {
    const address = "0x" + body.slice(2).toLowerCase();
    return { ok: true, address, kind: kind === "usdc" ? "usdc" : "eth" };
  }

  const named = body.toLowerCase();
  const implicit = /^[0-9a-f]{64}$/.test(named);
  const account = implicit || (NAMED.test(named) && (named.endsWith(".near") || named.endsWith(".testnet")));
  if (!account) {
    return { ok: false, error: "Use a NEAR account such as name.near, a 64 character implicit account, or an 0x address for ETH or USDC." };
  }
  return { ok: true, address: named, kind: kind === "usdc" ? "usdc" : "near" };
}

export function agentIdFor(address) {
  const hex = createHash("sha256").update(`clanksmith/v1\n${address}`).digest("hex").slice(0, 16);
  return `cs_${hex}`;
}

export function identity(input) {
  const parsed = parsePayout(input);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    agent: {
      agentId: agentIdFor(parsed.address),
      payoutAddress: parsed.address,
      payoutKind: parsed.kind,
    },
  };
}
