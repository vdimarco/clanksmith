// In-memory ledger: who submitted what, the score, which row was forwarded,
// and what payout is owed. Approving a row does not move funds.
import { randomUUID } from "node:crypto";
import { identity } from "./address.mjs";
import { scoreSubmission } from "./proof.mjs";
import { executeForward, latestForward, planForwardCalls } from "./forward.mjs";
import { compareRank, isPayableLeader, resolveFinish, selectWinner } from "./finish.mjs";

const PER_JOB_CAP = 3;

export function emptyState() {
  return { version: 1, agents: {}, submissions: [], forwards: [] };
}

export function submissionId() {
  return `sub_${randomUUID()}`;
}

function payoutFor(kind, job) {
  if (kind === "owed") {
    return {
      state: "owed",
      currency: job.currency,
      upperBound: job.reward,
      approval: "required",
      fundsMoved: false,
      note: "Owed only if this forwarded entry wins. A person must approve it. The pool is an upper bound, because the market may split USDC. No funds have moved.",
    };
  }
  if (kind === "approved") {
    return {
      state: "approved",
      currency: job.currency,
      upperBound: job.reward,
      approval: "approved",
      fundsMoved: false,
      note: "A person approved this payout. No funds have moved.",
    };
  }
  if (kind === "not_selected") {
    return {
      state: "not_selected",
      currency: job.currency,
      upperBound: "0.00",
      approval: "not_applicable",
      fundsMoved: false,
      note: "A higher passing submission was forwarded instead.",
    };
  }
  if (kind === "hold") {
    return {
      state: "hold",
      currency: job.currency,
      upperBound: job.reward,
      approval: "required",
      fundsMoved: false,
      note: "The proof check passed, and the market forward did not. No funds have moved.",
    };
  }
  return {
    state: "failed",
    currency: job.currency,
    upperBound: "0.00",
    approval: "not_applicable",
    fundsMoved: false,
    note: "The proof check did not pass, so this row cannot be paid.",
  };
}

function latestByAgent(rows) {
  const latest = new Map();
  for (const row of rows) {
    const prev = latest.get(row.agentId);
    if (!prev || prev.submittedAt <= row.submittedAt) latest.set(row.agentId, row);
  }
  return latest;
}

export function rankJob(state, job, now) {
  const finish = job.finish || resolveFinish({ proof: job.proof, description: job.description, deadline: job.deadline, reward: job.reward });
  const rows = state.submissions.filter((row) => row.jobId === job.jobId);
  const latest = latestByAgent(rows);
  const ranked = [...latest.values()].sort((a, b) => compareRank(a, b, finish));
  const outcome = selectWinner([...latest.values()], finish, now);
  for (const row of rows) {
    const current = latest.get(row.agentId);
    row.current = current?.submissionId === row.submissionId;
    row.rank = row.current ? ranked.findIndex((item) => item.submissionId === row.submissionId) + 1 : null;
    row.updatedAt = now;
  }
  return outcome;
}

function settlePayouts(state, job, { best, forwardedId, holdId }) {
  const rows = state.submissions.filter((row) => row.jobId === job.jobId);
  for (const row of rows) {
    if (row.submissionId === forwardedId) {
      row.forwarded = true;
      row.payout = row.payout?.approval === "approved" ? payoutFor("approved", job) : payoutFor("owed", job);
      continue;
    }
    row.forwarded = false;
    if (row.submissionId === holdId) row.payout = payoutFor("hold", job);
    else if (!row.proof.pass) row.payout = payoutFor("failed", job);
    else if (!row.current) row.payout = { ...payoutFor("not_selected", job), state: "superseded", note: "A later submission from this agent replaced this one." };
    else if (best && row.submissionId === best.submissionId) row.payout = payoutFor("hold", job);
    else row.payout = payoutFor("not_selected", job);
  }
}

export function publicSubmission(row) {
  return {
    submissionId: row.submissionId,
    jobId: row.jobId,
    jobTitle: row.jobTitle,
    agentId: row.agentId,
    payoutKind: row.payoutKind,
    submittedAt: row.submittedAt,
    proof: row.proof,
    rank: row.rank,
    current: row.current,
    forwarded: row.forwarded,
    payout: row.payout,
  };
}

function httpLinks(values, label, limit) {
  const list = Array.isArray(values) ? values : [];
  if (list.length > limit) return { ok: false, error: `Send at most ${limit} ${label}.` };
  const links = [];
  for (const value of list) {
    const link = String(value || "").trim();
    if (!link) continue;
    if (link.length > 500 || !/^https?:\/\//i.test(link)) return { ok: false, error: `Each ${label} entry must be an http or https link.` };
    links.push(link);
  }
  return { ok: true, links };
}

export async function recordSubmission(state, args, ctx, job) {
  const who = identity(args.payout_address);
  if (!who.ok) return { ok: false, error: who.error, state };
  const text = String(args.text ?? "");
  if (!text.trim()) return { ok: false, error: "The submission text is empty.", state };
  if (Buffer.byteLength(text) > 96 * 1024) return { ok: false, error: "Submission text is over 96 KiB.", state };
  const urls = httpLinks(args.urls, "url", 10);
  if (!urls.ok) return { ok: false, error: urls.error, state };
  const files = httpLinks(args.files, "file", 5);
  if (!files.ok) return { ok: false, error: files.error, state };

  const now = ctx.now();
  const finish = job.finish || resolveFinish({ proof: job.proof, description: job.description, deadline: job.deadline, reward: job.reward });
  const agent = { ...who.agent, createdAt: state.agents[who.agent.agentId]?.createdAt || now };
  const next = {
    ...state,
    agents: { ...state.agents, [agent.agentId]: agent },
    submissions: state.submissions.slice(),
    forwards: state.forwards.slice(),
  };

  const requestId = args.client_request_id ? String(args.client_request_id).slice(0, 80) : "";
  if (requestId) {
    const prior = next.submissions.find((row) => row.agentId === agent.agentId && row.jobId === job.jobId && row.clientRequestId === requestId);
    if (prior) return { ok: true, state: next, submission: prior, replayed: true, forward: latestForward(next, job.jobId), finish };
  }

  const already = selectWinner(next.submissions.filter((row) => row.jobId === job.jobId), finish, now);
  if (already.closed) {
    const error = already.status === "won/closed" ? "This bounty is won and closed." : "This bounty is closed.";
    return { ok: false, error, state };
  }

  const mine = next.submissions.filter((row) => row.agentId === agent.agentId && row.jobId === job.jobId);
  if (mine.length >= PER_JOB_CAP) {
    return { ok: false, error: `This agent already has ${PER_JOB_CAP} submissions on this bounty.`, state };
  }

  const proof = scoreSubmission(job.proof, { text, urls: urls.links, files: files.links });
  const metricRaw = Number(args.metric_value ?? args.metricValue);
  const submission = {
    submissionId: submissionId(),
    jobId: job.jobId,
    jobTitle: job.title,
    agentId: agent.agentId,
    payoutAddress: agent.payoutAddress,
    payoutKind: agent.payoutKind,
    text,
    urls: urls.links,
    files: files.links,
    clientRequestId: requestId || null,
    submittedAt: now,
    metricValue: Number.isFinite(metricRaw) ? metricRaw : null,
    finish,
    proof,
    rank: null,
    current: true,
    forwarded: false,
    payout: payoutFor(proof.pass ? "owed" : "failed", job),
  };
  next.submissions.push(submission);
  const previous = latestForward(next, job.jobId);
  const previousApproved = previous
    ? next.submissions.some((row) => row.submissionId === previous.submissionId && row.payout?.approval === "approved")
    : false;
  const outcome = rankJob(next, { ...job, finish }, now);
  const leader = outcome.leader;
  const best = isPayableLeader(leader, finish, outcome) ? leader : null;

  let forward = null;
  let forwardedId = previous?.ok ? previous.submissionId : null;
  let holdId = null;
  if (best && best.submissionId === submission.submissionId) {
    const planned = planForwardCalls(job, submission, previous);
    if (!planned.ok) {
      submission.forwardError = planned.error;
      holdId = submission.submissionId;
    } else {
      const sent = await executeForward(ctx.market, ctx.config, planned.calls);
      forward = {
        jobId: job.jobId,
        submissionId: submission.submissionId,
        agentId: submission.agentId,
        score: submission.proof.score,
        at: now,
        dryRun: sent.dryRun !== false,
        ok: sent.ok,
        error: sent.error || null,
        calls: sent.calls,
        marketAssignmentId: sent.marketAssignmentId || previous?.marketAssignmentId || null,
        superseded: !sent.ok,
        needsReview: sent.ok && previousApproved,
      };
      next.forwards.push(forward);
      if (sent.ok) {
        if (previous) previous.superseded = true;
        forwardedId = submission.submissionId;
      } else {
        submission.forwardError = sent.error;
        holdId = submission.submissionId;
      }
    }
  }
  settlePayouts(next, job, { best, forwardedId, holdId });

  return { ok: true, state: next, submission, replayed: false, forward, bestId: best?.submissionId || null, finish, outcome };
}

export function approvePayout(state, submissionId) {
  const row = state.submissions.find((item) => item.submissionId === submissionId);
  if (!row) return { ok: false, error: "No submission with that id." };
  if (row.payout?.state !== "owed" || !row.forwarded) {
    return { ok: false, error: "Only a forwarded row that is still owed can be approved." };
  }
  const next = {
    ...state,
    submissions: state.submissions.map((item) => item.submissionId === submissionId
      ? {
        ...item,
        payout: {
          ...item.payout,
          state: "approved",
          approval: "approved",
          fundsMoved: false,
          note: "A person approved this payout. No funds have moved.",
        },
      }
      : item),
  };
  return { ok: true, state: next, submission: next.submissions.find((item) => item.submissionId === submissionId) };
}

export function ledgerView(state) {
  return {
    agents: Object.values(state.agents).map(({ agentId, payoutAddress, payoutKind, createdAt }) => ({ agentId, payoutAddress, payoutKind, createdAt })),
    submissions: state.submissions.map((row) => ({
      ...publicSubmission(row),
      payoutAddress: row.payoutAddress,
      forwardError: row.forwardError || null,
    })),
    forwards: state.forwards.map((row) => ({
      jobId: row.jobId,
      submissionId: row.submissionId,
      agentId: row.agentId,
      score: row.score,
      dryRun: row.dryRun,
      ok: row.ok,
      superseded: !!row.superseded,
      marketAssignmentId: row.marketAssignmentId,
      calls: (row.calls || []).map((call) => ({ method: call.method, path: call.path, auth: call.auth })),
    })),
  };
}
