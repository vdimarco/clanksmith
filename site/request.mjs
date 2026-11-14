const POST_LIMIT = 240;
const localDate = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function buildRequestPost({ task, done, budget, currency, deadline }) {
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
  const price = amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  const post = `@clanksmith\nTask: ${work}\nBudget: $${price} ${currency}\nDone when: ${result}\nBy: ${deadline}`;
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
  const preview = form.querySelector("#request-preview");
  const status = form.querySelector("#request-status");
  const fallback = document.querySelector("#request-fallback");
  deadline.min = localDate(new Date());
  const values = () => ({ task: task.value, done: done.value, budget: budget.value, currency: currency.value, deadline: deadline.value });
  const update = () => {
    status.textContent = "";
    status.classList.remove("is-error");
    if (![task.value, done.value, budget.value, deadline.value].every((value) => value.trim())) {
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
    budget.value = "50";
    currency.value = "USD";
    const due = new Date();
    due.setDate(due.getDate() + 14);
    deadline.value = localDate(due);
    update();
    status.textContent = "Illustrative brief only. Edit it for your job; the budget is not a quote.";
    task.focus();
  });
  update();
}
