// The four agent operations. State in, state out. The market client is injected.
import { identity } from "./address.mjs";
import { describeFinish } from "./finish.mjs";
import { isClanksmith, isOpen, loadBoard, loadJob, publicJob } from "./jobs.mjs";
import { approvePayout, emptyState, publicSubmission, recordSubmission } from "./ledger.mjs";

export { emptyState, approvePayout };

function agentResult(input) {
  if (!input) return { ok: true, agent: null };
  const who = identity(input);
  if (!who.ok) return who;
  return { ok: true, agent: { agentId: who.agent.agentId, payoutKind: who.agent.payoutKind } };
}

function meta(ctx) {
  return { dryRun: ctx.config.dryRun !== false, liveWrites: ctx.config.liveWrites === true };
}

export async function apply(state, op, args = {}, ctx) {
  const now = ctx.now();
  if (op === "list_jobs") return listJobs(state, args, ctx, now);
  if (op === "get_job") return getJob(state, args, ctx, now);
  if (op === "submit") return submit(state, args, ctx);
  if (op === "status") return status(state, args, ctx);
  if (op === "approve_payout") {
    const out = approvePayout(state, args.submission_id || args.submissionId);
    if (!out.ok) return { state, result: { ok: false, error: out.error, fundsMoved: false } };
    return { state: out.state, result: { ok: true, fundsMoved: false, submission: publicSubmission(out.submission) } };
  }
  throw new Error(`Unknown operation ${op}`);
}

async function listJobs(state, args, ctx, now) {
  const who = agentResult(args.payout_address);
  if (!who.ok) return { state, result: { ok: false, error: who.error, ...meta(ctx) } };
  const board = await loadBoard(ctx.market);
  const jobs = board.jobs.filter((job) => isClanksmith(job) && isOpen(job, now)).map((job) => publicJob({ ...job, open: true }));
  return {
    state,
    result: {
      ok: board.ok,
      error: board.ok ? null : board.error,
      ...meta(ctx),
      agent: who.agent,
      onboarding: who.agent
        ? "This payout address is your Clanksmith agent. No market account and no aat_ token are required."
        : "Send X-Payout-Address, a NEAR account or an 0x address, to get a Clanksmith agent id.",
      jobs,
    },
  };
}

async function getJob(state, args, ctx, now) {
  const who = agentResult(args.payout_address);
  if (!who.ok) return { state, result: { ok: false, error: who.error, ...meta(ctx) } };
  const jobId = String(args.job_id || args.jobId || "");
  if (!jobId) return { state, result: { ok: false, error: "job_id is required.", ...meta(ctx) } };
  const loaded = await loadJob(ctx.market, jobId);
  if (!loaded.ok) return { state, result: { ok: false, error: loaded.error, ...meta(ctx), agent: who.agent } };
  if (!isClanksmith(loaded.job)) return { state, result: { ok: false, error: "That job is not a Clanksmith bounty.", ...meta(ctx), agent: who.agent } };
  const open = isOpen(loaded.job, now);
  return {
    state,
    result: {
      ok: true,
      ...meta(ctx),
      agent: who.agent,
      job: publicJob({ ...loaded.job, open }, { full: true }),
    },
  };
}

async function submit(state, args, ctx) {
  const jobId = String(args.job_id || args.jobId || "");
  if (!jobId) return { state, result: { ok: false, error: "job_id is required.", ...meta(ctx) } };
  if (!args.payout_address) {
    return { state, result: { ok: false, error: "A payout address is required. Send X-Payout-Address or payout_address. No market account is required.", ...meta(ctx) } };
  }
  const loaded = await loadJob(ctx.market, jobId);
  if (!loaded.ok) return { state, result: { ok: false, error: loaded.error, ...meta(ctx) } };
  if (!isClanksmith(loaded.job)) return { state, result: { ok: false, error: "That job is not a Clanksmith bounty.", ...meta(ctx) } };
  if (!isOpen(loaded.job, ctx.now())) return { state, result: { ok: false, error: "This bounty is closed.", ...meta(ctx) } };
  const saved = await recordSubmission(state, args, ctx, loaded.job);
  if (!saved.ok) return { state, result: { ok: false, error: saved.error, ...meta(ctx) } };
  const row = saved.state.submissions.find((item) => item.submissionId === saved.submission.submissionId) || saved.submission;
  const ownForward = saved.forward && saved.forward.submissionId === row.submissionId ? saved.forward : null;
  return {
    state: saved.state,
    result: {
      ok: true,
      replayed: saved.replayed,
      ...meta(ctx),
      agent: { agentId: row.agentId, payoutKind: row.payoutKind },
      submission: publicSubmission(row),
      finish: jobFinish(loaded.job, saved.state, ctx.now()),
      preJudge: {
        pass: row.proof.pass,
        score: row.proof.score,
        reason: row.proof.reason,
        rank: row.rank,
        forwarded: row.forwarded,
        best: saved.bestId === row.submissionId,
      },
      forward: ownForward ? {
        dryRun: ownForward.dryRun,
        ok: ownForward.ok,
        error: ownForward.error,
        marketAssignmentId: ownForward.marketAssignmentId,
        calls: (ownForward.calls || []).map((call) => ({ method: call.method, path: call.path, auth: call.auth })),
      } : null,
    },
  };
}

function jobFinish(job, state, now) {
  if (!job?.finish) return null;
  const rows = (state.submissions || []).filter((row) => row.jobId === job.jobId);
  return describeFinish(job.finish, rows, now);
}

async function status(state, args, ctx) {
  const who = identity(args.payout_address);
  if (!who.ok) return { state, result: { ok: false, error: who.error } };
  const jobId = args.job_id || args.jobId || "";
  const submissionId = args.submission_id || args.submissionId || "";
  if (!jobId) {
    return { state, result: { ok: false, error: "job_id is required.", agent: { agentId: who.agent.agentId, payoutKind: who.agent.payoutKind } } };
  }
  let rows = state.submissions.filter((row) => row.agentId === who.agent.agentId);
  if (jobId) rows = rows.filter((row) => row.jobId === jobId);
  if (submissionId) rows = rows.filter((row) => row.submissionId === submissionId);
  const loaded = await loadJob(ctx.market, jobId);
  const job = loaded.ok ? loaded.job : null;
  const stored = state.submissions.find((row) => row.jobId === jobId)?.finish;
  const finish = job?.finish ? jobFinish(job, state, ctx.now()) : (stored ? describeFinish(stored, state.submissions.filter((row) => row.jobId === jobId), ctx.now()) : null);
  return {
    state,
    result: {
      ok: true,
      agent: { agentId: who.agent.agentId, payoutKind: who.agent.payoutKind },
      finish,
      submissions: rows.map(publicSubmission),
    },
  };
}
