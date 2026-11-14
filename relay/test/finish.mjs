// Winner selection for speed (first to the target) and quality (best by the deadline).
import { describeFinish, resolveFinish, selectWinner } from "../finish.mjs";

function row(submissionId, submittedAt, value, agentId = submissionId) {
  return {
    submissionId,
    agentId,
    submittedAt,
    metricValue: value,
    proof: { score: value, pass: value >= 80 },
  };
}

export function runFinishChecks(ok) {
  const speed = { mode: "speed", metric: "score", target: 80 };
  const early = selectWinner([
    row("a", "2026-11-14T08:00:00.000Z", 10),
    row("b", "2026-11-14T09:00:00.000Z", 80),
    row("c", "2026-11-14T10:00:00.000Z", 100),
  ], speed, "2026-11-14T12:00:00.000Z");
  ok("speed mode pays the first submission that hits the target", early.closed && early.status === "won/closed" && early.winner.submissionId === "b");
  ok("a later higher speed score does not take the win", early.winner.submissionId !== "c");

  const waiting = selectWinner([row("a", "2026-11-14T08:00:00.000Z", 10)], speed, "2026-11-14T12:00:00.000Z");
  ok("speed mode stays open until the target is hit", !waiting.closed && waiting.status === "open" && waiting.winner == null);

  const quality = {
    mode: "quality",
    metric: "score",
    direction: "higher",
    deadline: "2026-11-20T00:00:00.000Z",
    budget: "40.00",
  };
  const during = selectWinner([
    row("low", "2026-11-14T08:00:00.000Z", 70),
    row("high", "2026-11-14T09:00:00.000Z", 90),
  ], quality, "2026-11-14T12:00:00.000Z");
  ok("quality mode keeps the best score as leader before the deadline", !during.closed && during.status === "open" && during.leader.submissionId === "high" && during.timeLeftMs > 0);

  const after = selectWinner([
    row("low", "2026-11-14T08:00:00.000Z", 70),
    row("high", "2026-11-14T09:00:00.000Z", 90),
  ], quality, "2026-11-20T00:00:00.000Z");
  ok("quality mode pays the best score when the deadline hits", after.closed && after.status === "closed" && after.winner.submissionId === "high" && after.timeLeftMs === 0);

  const tied = selectWinner([
    row("later", "2026-11-14T10:00:00.000Z", 90),
    row("earlier", "2026-11-14T08:00:00.000Z", 90),
  ], quality, "2026-11-21T00:00:00.000Z");
  ok("a quality tie goes to the earlier submission", tied.winner.submissionId === "earlier");

  const lower = {
    mode: "quality",
    metric: "errors",
    direction: "lower",
    deadline: "2026-11-20T00:00:00.000Z",
    budget: "40.00",
  };
  const fewer = selectWinner([
    row("five", "2026-11-14T08:00:00.000Z", 5),
    row("three-late", "2026-11-14T11:00:00.000Z", 3),
    row("three-early", "2026-11-14T09:00:00.000Z", 3),
  ], lower, "2026-11-20T00:00:01.000Z");
  ok("lower-is-better quality picks the smaller score, then the earlier tie", fewer.winner.submissionId === "three-early");

  const described = describeFinish(quality, [
    row("low", "2026-11-14T08:00:00.000Z", 70),
    row("high", "2026-11-14T09:00:00.000Z", 90),
  ], "2026-11-14T12:00:00.000Z");
  ok("status names the quality leader and the time left", described.mode === "quality" && described.leader.value === 90 && described.leader.submissionId === "high" && described.timeLeft != null && described.winner == null);

  const unlabeled = resolveFinish({ proof: { minScore: 80, checks: [{}] }, deadline: "2026-12-01T00:00:00.000Z", reward: "25.00" });
  ok("a job with no mode defaults to speed", unlabeled.mode === "speed" && unlabeled.metric === "score" && unlabeled.target === 80);

  const fromPost = resolveFinish({
    description: "@clanksmith\nTask: Summarize interviews\nFinish: quality, latency lower\nBudget: $50 USD\nDone when: a one-page brief\nBy: 2099-12-01",
  });
  ok("a work-order post parses quality mode, metric, direction, deadline, and budget", fromPost.mode === "quality" && fromPost.metric === "latency" && fromPost.direction === "lower" && fromPost.deadline === "2099-12-01T00:00:00.000Z" && fromPost.budget === "50.00");

  const speedPost = resolveFinish({
    description: "Finish: speed, tests pass >= 1\nBudget: $50 USD\nBy: 2099-12-01",
    proof: { minScore: 80 },
  });
  ok("a speed post parses the metric and the target", speedPost.mode === "speed" && speedPost.metric === "tests pass" && speedPost.target === 1);
}
