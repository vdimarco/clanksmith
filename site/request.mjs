const POST_LIMIT = 240;
const localDate = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function trimNumber(value) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

export function buildRequestPost({ task, done, budget, currency, deadline, mode, metric, target, direction }) {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const work = clean(task);
  const result = clean(done);
  const amount = Number(budget);
  if (!work || !result) throw new Error("Add the task and what counts as done.");
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 1000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    throw new Error("Enter a budget between 0.01 and 1,000,000 with at most two decimals.");
  }
  if (currency !== "USD" && currency !== "USDC") throw new Error("Choose USD or USDC.");
  const due = new Date(`${deadline}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(due.getTime()) || due.toISOString().slice(0, 10) !== deadline || deadline < localDate(new Date())) {
    throw new Error("Choose a real deadline today or later.");
  }
  const finishMode = mode === "quality" ? "quality" : "speed";
  const metricName = clean(metric || "score").replace(/[<>]/g, "").slice(0, 40);
  if (!metricName) throw new Error("Name the metric you will measure.");
  let finishLine;
  if (finishMode === "quality") {
    const way = direction === "lower" ? "lower" : "higher";
    finishLine = `Finish: quality, ${metricName} ${way}`;
  } else {
    const goal = Number(target ?? 80);
    if (!Number.isFinite(goal)) throw new Error("Enter a target number for speed mode.");
    finishLine = `Finish: speed, ${metricName} >= ${trimNumber(goal)}`;
  }
  const price = amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  const post = `@clanksmith\nTask: ${work}\n${finishLine}\nBudget: $${price} ${currency}\nDone when: ${result}\nBy: ${deadline}`;
  if (Array.from(post).length > POST_LIMIT) throw new Error("Shorten the task or result so the X draft fits.");
  return post;
}

const form = typeof document === "undefined" ? null : document.querySelector("#request-form");
if (form) {
  const task = form.querySelector("#request-task");
  const done = form.querySelector("#request-done");
  const budget = form.querySelector("#request-budget");
  const currency = form.querySelector("#request-currency");
  const deadline = form.querySelector("#request-deadline");
  const mode = form.querySelector("#request-mode");
  const metric = form.querySelector("#request-metric");
  const target = form.querySelector("#request-target");
  const direction = form.querySelector("#request-direction");
  const targetField = form.querySelector("#request-target-field");
  const directionField = form.querySelector("#request-direction-field");
  const preview = form.querySelector("#request-preview");
  const status = form.querySelector("#request-status");
  const fallback = document.querySelector("#request-fallback");
  deadline.min = localDate(new Date());
  const syncMode = () => {
    const quality = mode.value === "quality";
    targetField.classList.toggle("is-off", quality);
    directionField.classList.toggle("is-off", !quality);
  };
  const values = () => ({
    task: task.value,
    done: done.value,
    budget: budget.value,
    currency: currency.value,
    deadline: deadline.value,
    mode: mode.value,
    metric: metric.value,
    target: target.value,
    direction: direction.value,
  });
  const update = () => {
    syncMode();
    status.textContent = "";
    status.classList.remove("is-error");
    const ready = [task.value, done.value, budget.value, deadline.value, metric.value].every((value) => value.trim())
      && (mode.value === "quality" || String(target.value).trim());
    if (!ready) {
      preview.textContent = "Fill in the fields to see your post.";
      return;
    }
    try { preview.textContent = buildRequestPost(values()); }
    catch (error) {
      preview.textContent = error.message;
      status.textContent = error.message;
      status.classList.add("is-error");
    }
  };
  form.hidden = false;
  fallback.hidden = true;
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (event) => {
    try { form.querySelector('input[name="text"]').value = buildRequestPost(values()); }
    catch (error) {
      event.preventDefault();
      status.textContent = error.message;
      status.classList.add("is-error");
    }
  });
  form.querySelector("#request-sample").addEventListener("click", () => {
    task.value = "Summarize 20 customer interviews";
    done.value = "One-page brief with five cited themes and source links";
    mode.value = "speed";
    metric.value = "tests pass";
    target.value = "1";
    direction.value = "higher";
    budget.value = "50";
    currency.value = "USD";
    const due = new Date();
    due.setDate(due.getDate() + 14);
    deadline.value = localDate(due);
    update();
    status.textContent = "That's just an example. Change it to your job; the budget isn't a quote.";
    task.focus();
  });
  update();
}
