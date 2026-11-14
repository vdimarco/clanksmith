// The market allows one entry per builder. Clanksmith forwards only the current
// best passing submission, and later winners replace it with another submit.

const JUDGE_LIMIT = 96 * 1024;

export function composeDeliverable(job, submission) {
  const lines = [
    `# ${job.title}`,
    "",
    `Clanksmith agent: ${submission.agentId}`,
    "",
    String(submission.text || "").trim(),
  ];
  if (submission.urls?.length) {
    lines.push("", "## Links", ...submission.urls.map((url) => `- ${url}`));
  }
  if (submission.files?.length) {
    lines.push("", "## Files", ...submission.files.map((url) => `- ${url}`));
  }
  return lines.join("\n");
}

export function latestForward(state, jobId) {
  const rows = (state.forwards || []).filter((row) => row.jobId === jobId && !row.superseded);
  return rows[rows.length - 1] || null;
}

export function planForwardCalls(job, submission, previous) {
  const markdown = composeDeliverable(job, submission);
  if (Buffer.byteLength(markdown) > JUDGE_LIMIT) {
    return { ok: false, error: "The work is over 96 KiB, which is the most the market judge reads. It was not forwarded." };
  }
  const calls = [];
  if (!previous) {
    calls.push({ method: "POST", path: `/v1/jobs/${job.jobId}/entries`, body: {}, auth: "agent" });
  }
  const assignmentId = previous?.marketAssignmentId || "dry-run";
  const body = { deliverableMarkdown: markdown };
  const files = (submission.files || []).filter((url) => /^https:\/\/market\.near\.ai\/files\//.test(url));
  if (files.length) body.files = files;
  calls.push({
    method: "POST",
    path: `/v1/assignments/${assignmentId}/submit`,
    body,
    auth: "agent",
  });
  return { ok: true, calls, markdown };
}

export async function executeForward(market, config, calls) {
  if (!config.liveWrites) {
    const recorded = [];
    for (const call of calls) {
      const row = await market.post(call.path, call.body, "agent");
      recorded.push({ method: "POST", path: call.path, body: call.body, auth: "agent", dryRun: true, result: row?.dryRun === true });
    }
    return { ok: true, dryRun: true, calls: recorded, marketAssignmentId: null };
  }
  if (!config.agentToken) {
    return { ok: false, dryRun: false, error: "Live writes are on, and AGENT_MARKET_AGENT_TOKEN is empty. Nothing was sent.", calls: [] };
  }
  let assignmentId = null;
  const recorded = [];
  for (const call of calls) {
    let path = call.path;
    if (assignmentId) path = path.replace("/assignments/dry-run/", `/assignments/${assignmentId}/`);
    try {
      const row = await market.post(path, call.body, "agent");
      const found = row?.assignmentId || row?.assignment_id;
      if (found) assignmentId = found;
      recorded.push({ method: "POST", path, body: call.body, auth: "agent", dryRun: false });
    } catch (err) {
      return {
        ok: false,
        dryRun: false,
        error: `Market write refused (${err.status || "error"}). Nothing further was sent.`,
        calls: recorded,
        marketAssignmentId: assignmentId,
      };
    }
  }
  return { ok: true, dryRun: false, calls: recorded, marketAssignmentId: assignmentId };
}
