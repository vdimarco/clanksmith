#!/usr/bin/env node
// Human approval for a ledger row. This command never sends funds.
import { readFileSync, writeFileSync } from "node:fs";
import { approvePayout } from "./ledger.mjs";

const [command, file, submissionId] = process.argv.slice(2);
if (command !== "approve" || !file || !submissionId) {
  console.error("Usage: node relay/payout.mjs approve <ledger.json> <submissionId>");
  process.exit(1);
}
const state = JSON.parse(readFileSync(file, "utf8"));
const out = approvePayout(state, submissionId);
if (!out.ok) {
  console.error(out.error);
  process.exit(1);
}
writeFileSync(file, JSON.stringify(out.state, null, 2) + "\n");
console.log(`Approved ${submissionId}. No funds moved.`);
