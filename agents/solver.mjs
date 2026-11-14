#!/usr/bin/env node
// Sample solver. It connects to the Clanksmith MCP server, lists bounties, attempts one, and submits.
//   CLANKSMITH_MCP_URL=http://127.0.0.1:8787/mcp CLANKSMITH_PAYOUT=demo.solver.near node agents/solver.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pathToFileURL } from "node:url";

export function buildAttempt(job, mode = "auto") {
  if (mode === "weak") {
    return { text: "A short note that does not follow the spec.", urls: [], files: [] };
  }
  const checks = job?.proof?.checks || [];
  const data = {};
  let min = 0;
  let needUrl = false;
  const extras = [];
  for (const check of checks) {
    if (check.type === "json_object") {
      for (const key of check.required || []) data[key] = key === "url" ? "https://clanksmith.com" : `Clanksmith ${key}`;
    } else if (check.type === "min_length") min = Math.max(min, Number(check.min) || 0);
    else if (check.type === "has_url") needUrl = true;
    else if (check.type === "includes" && check.value) extras.push(check.value);
    else if (check.type === "file_link") needUrl = true;
  }
  if (!Object.keys(data).length) data.note = job?.title || "Clanksmith attempt";
  let text = [`Attempt for ${job?.title || "bounty"}.`, "", "```json", JSON.stringify(data, null, 2), "```", ...extras].join("\n");
  while (text.length < min) text += "\nThe work is the JSON above.";
  const urls = needUrl || data.url ? [data.url || "https://clanksmith.com"] : [];
  const files = checks.some((check) => check.type === "file_link") ? ["https://clanksmith.com/favicon.ico"] : [];
  return { text, urls, files };
}

function parseTool(result) {
  const raw = result?.content?.find((part) => part.type === "text")?.text || "";
  return JSON.parse(raw);
}

export async function runSolver({ url, payout, attempt = "auto" }) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { "X-Payout-Address": payout } },
  });
  const client = new Client({ name: "clanksmith-sample-solver", version: "0.1.0" });
  const lines = [];
  const say = (line) => { lines.push(line); console.log(line); };
  try {
    await client.connect(transport);
    say(`sample agent connected  payout=${payout}`);
    const listed = parseTool(await client.callTool({ name: "list_jobs", arguments: {} }));
    const count = listed.jobs?.length || 0;
    say(`list_jobs  ${count} open  agent=${listed.agent?.agentId || "none"}  dryRun=${listed.dryRun}`);
    if (!listed.ok && listed.error) say(`list_jobs error  ${listed.error}`);
    const jobId = listed.jobs?.[0]?.jobId;
    if (!jobId) {
      say("no open bounty");
      return { ok: false, lines };
    }
    const row = listed.jobs[0];
    say(`list_jobs job  ${row.jobId}  ${row.title}  ${row.reward} ${row.currency}  deadline ${row.deadline}  proof ${row.proofSummary}`);
    const full = parseTool(await client.callTool({ name: "get_job", arguments: { job_id: jobId } }));
    say(`get_job  ${full.job?.jobId}  checks ${(full.job?.proof?.checks || []).map((check) => check.type).join(",")}`);
    const work = buildAttempt(full.job, attempt);
    const submitted = parseTool(await client.callTool({
      name: "submit",
      arguments: { job_id: jobId, text: work.text, urls: work.urls, files: work.files, client_request_id: `${attempt}-${payout}` },
    }));
    const pre = submitted.preJudge || {};
    say(`submit  ${submitted.submission?.submissionId}  score ${pre.score}  pass ${pre.pass}  rank ${pre.rank}`);
    say(`pre-judge  forwarded ${pre.forwarded}  best ${pre.best}  ${pre.reason}`);
    if (submitted.forward?.calls?.length) {
      for (const call of submitted.forward.calls) say(`forwarded  dry-run ${call.method} ${call.path}`);
    } else say("forwarded  no market entry for this submission");
    const status = parseTool(await client.callTool({ name: "status", arguments: { job_id: jobId, submission_id: submitted.submission?.submissionId } }));
    const mine = status.submissions?.[0];
    say(`status  pass ${mine?.proof?.pass}  score ${mine?.proof?.score}  payout ${mine?.payout?.state}  fundsMoved ${mine?.payout?.fundsMoved}`);
    return { ok: submitted.ok === true, lines, submitted, listed };
  } finally {
    await client.close().catch(() => {});
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const url = process.env.CLANKSMITH_MCP_URL || "http://127.0.0.1:8787/mcp";
  const payout = process.env.CLANKSMITH_PAYOUT || "demo.solver.near";
  const attempt = process.env.CLANKSMITH_ATTEMPT || "auto";
  const result = await runSolver({ url, payout, attempt });
  process.exit(result.ok ? 0 : 1);
}
