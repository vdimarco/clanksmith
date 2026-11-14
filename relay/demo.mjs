#!/usr/bin/env node
// Dry-run demo: sample agent, list, submit, pre-judge, mocked forward, ledger.
// Nothing on the market is written, and no funds move.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { demoJob, mockFetch } from "./catalog.mjs";
import { approvePayout, ledgerView } from "./ledger.mjs";
import { startLocal } from "../mcp/local.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

const NOW = "2026-11-14T08:00:00.000Z";

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function runDemo() {
  const market = mockFetch([demoJob()]);
  const local = await startLocal({
    env: { AGENT_MARKET_AGENT_TOKEN: "aat_demo_not_a_real_token", CLANKSMITH_LIVE_WRITES: "false" },
    fetchImpl: market.fetchImpl,
    now: () => NOW,
  });
  const lines = ["Clanksmith dry run. The market mock refuses writes. No funds moved.", ""];
  try {
    const weak = await runNode(["agents/solver.mjs"], {
      CLANKSMITH_MCP_URL: local.url,
      CLANKSMITH_PAYOUT: "weak.solver.near",
      CLANKSMITH_ATTEMPT: "weak",
    });
    lines.push(weak.stdout.trimEnd(), "");
    if (weak.code !== 0) lines.push(`weak solver exit ${weak.code}`, weak.stderr);

    const solver = await runNode(["agents/solver.mjs"], {
      CLANKSMITH_MCP_URL: local.url,
      CLANKSMITH_PAYOUT: "demo.solver.near",
      CLANKSMITH_ATTEMPT: "auto",
    });
    lines.push(solver.stdout.trimEnd(), "");
    if (solver.code !== 0) lines.push(`sample solver exit ${solver.code}`, solver.stderr);

    const view = ledgerView(local.holder.state);
    const winner = view.submissions.find((row) => row.forwarded);
    lines.push("pre-judge");
    for (const row of view.submissions) {
      lines.push(`  ${row.agentId}  ${row.payoutAddress}  score ${row.proof.score}  pass ${row.proof.pass}  rank ${row.rank}  forwarded ${row.forwarded}  payout ${row.payout.state}`);
    }
    lines.push("forwarded entry (mocked)");
    for (const row of view.forwards) {
      if (row.superseded) continue;
      for (const call of row.calls) lines.push(`  ${call.method} ${call.path}  auth ${call.auth}  dryRun ${row.dryRun}`);
    }
    lines.push("ledger entry");
    if (winner) {
      lines.push(`  submission ${winner.submissionId}  agent ${winner.agentId}  score ${winner.proof.score}  payout ${winner.payout.state}  upperBound ${winner.payout.upperBound} ${winner.payout.currency}  fundsMoved ${winner.payout.fundsMoved}`);
      const approved = approvePayout(local.holder.state, winner.submissionId);
      local.holder.state = approved.state;
      lines.push(`human approval  ${approved.ok ? "approved" : approved.error}  fundsMoved false`);
    } else lines.push("  no forwarded row");
    const writes = market.calls.filter((call) => call.method !== "GET");
    lines.push(`market writes sent ${writes.length}`);
    lines.push("No funds moved.");
    if (weak.code !== 0 || solver.code !== 0) {
      return { ok: false, log: lines.join("\n") + "\n", state: local.holder.state };
    }
    return { ok: true, log: lines.join("\n") + "\n", state: local.holder.state };
  } finally {
    await local.close();
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const result = await runDemo();
  writeFileSync(new URL("./demo.log", import.meta.url), result.log);
  process.stdout.write(result.log);
  process.exit(result.ok ? 0 : 1);
}
