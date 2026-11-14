// The ledger page (chain.html) prints the on-chain job title. The market id goes in that
// title, which the contract stores and the page already shows. Spec stays the check JSON.
import { evidenceHash } from "../appeals/lib/hash.mjs";

export function chainTitle(label, marketJobId) {
  const mark = `mkt:${marketJobId}`;
  const head = String(label || "job").trim();
  const room = 80 - mark.length - 1;
  const clipped = room > 0 ? head.slice(0, room) : "";
  return `${clipped}${clipped ? " " : ""}${mark}`.slice(0, 80);
}

export function onChainPost(mention, marketJobId, contract) {
  return {
    network: contract.network,
    contract: contract.id,
    method: "post_job",
    args: {
      kind: mention.kind,
      title: chainTitle(mention.title, marketJobId),
      spec: JSON.stringify(mention.spec),
      budgetNear: mention.budgetNear,
      window_mins: 180,
    },
    signs: false,
  };
}

// Prepared only. Nothing here submits the appeal. The owner opens it with the existing appeals flow.
export function appealDraft(fields) {
  if (!fields) return { ready: false, reason: "no on-chain receipt yet" };
  const hash = evidenceHash(fields);
  return { ready: true, evidenceHash: hash, policy: "pay-on-proof-appeal/v1", fields };
}
