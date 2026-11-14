// Self-hosted seller loop for the clanksmith listing. Poll, start, submit.
// The aat_ token is the only credential this file sends. Dry run plans the calls.

export function planWorker(rows) {
  const actions = [];
  for (const row of rows || []) {
    const a = row.assignment || row;
    const id = a.assignmentId || a.assignment_id || a.id;
    const message = row.latestMessage || a.latestMessage || null;
    if (a.status === "in_progress" && a.submittedAt && message?.senderSide === "buyer") {
      actions.push({ action: "resubmit", assignmentId: id, feedback: message.body || "" });
      continue;
    }
    if (a.status === "in_progress" && !a.startedAt && !a.submittedAt) {
      actions.push({ action: "start", assignmentId: id });
      continue;
    }
    actions.push({ action: "skip", assignmentId: id, status: a.status || null });
  }
  return actions;
}

const fence = "`".repeat(3);

export function deliverableMarkdown(delivery) {
  return ["# Clanksmith delivery", "", fence + "json", JSON.stringify(delivery, null, 2), fence, ""].join("\n");
}

export async function runWorkerOnce({ client, rows, deliveryFor }) {
  const list = rows || (await client.get("/v1/agents/me/assignments", "agent"))?.assignments || [];
  const actions = planWorker(list);
  const sent = [];
  for (const step of actions) {
    if (step.action === "start") {
      sent.push(await client.post(`/v1/assignments/${step.assignmentId}/start`, {}, "agent"));
      const delivery = deliveryFor ? deliveryFor(step) : { note: "clanksmith" };
      sent.push(await client.post(`/v1/assignments/${step.assignmentId}/submit`, {
        deliverableMarkdown: deliverableMarkdown(delivery),
      }, "agent"));
    } else if (step.action === "resubmit") {
      const delivery = deliveryFor ? deliveryFor(step) : { note: "clanksmith", feedback: step.feedback };
      sent.push(await client.post(`/v1/assignments/${step.assignmentId}/submit`, {
        deliverableMarkdown: deliverableMarkdown(delivery),
      }, "agent"));
    }
  }
  return { actions, sent };
}
