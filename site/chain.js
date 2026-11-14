// Read the mainnet escrow and show its real counts and receipts.
// No key, no transaction. If the read fails, the page keeps the dated
// numbers and rows that are in the HTML.
(() => {
  const box = document.getElementById("chain-stats");
  const rows = document.getElementById("chain-rows");
  if (!box || !rows || !window.fetch) return;
  const RPC = "https://rpc.mainnet.fastnear.com";
  const CONTRACT = "ee4994a509efa3cc516411e75f2633b2d8eac2d05fc30cc558bfd43329cde827";
  const view = async (method, args) => {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: {
        request_type: "call_function", finality: "final", account_id: CONTRACT,
        method_name: method, args_base64: btoa(JSON.stringify(args || {})) } }),
    });
    const j = await r.json();
    if (j.error) throw new Error("rpc");
    return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
  };
  const all = async (method) => {
    const out = [];
    for (let from = 0; ; from += 50) {
      const page = await view(method, { from, limit: 50 });
      out.push(...page);
      if (page.length < 50) return out;
    }
  };
  // yoctoNEAR to NEAR with four decimals, without float rounding.
  const near = (yocto) => {
    const units = BigInt(yocto) / 10n ** 20n;
    return `${units / 10000n}.${String(units % 10000n).padStart(4, "0")} NEAR`;
  };
  const cell = (text) => {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
  };
  (async () => {
    const [cfg, receipts, jobs] = await Promise.all([view("get_config"), all("get_receipts"), all("get_jobs")]);
    const paid = receipts.filter((r) => r.pass);
    const counts = {
      jobs: cfg.jobs,
      paid: paid.length,
      refused: receipts.length - paid.length,
      intents: paid.filter((r) => r.rail === "intents").length,
    };
    if (Object.values(counts).some((n) => !Number.isInteger(n))) return;
    const titles = new Map(jobs.map((j) => [j.id, j.title]));
    const fresh = receipts.map((r) => {
      const tr = document.createElement("tr");
      const stamp = document.createElement("span");
      stamp.className = r.pass ? "st ok" : "st hot";
      stamp.textContent = r.pass ? "Paid" : "Refused";
      const last = document.createElement("td");
      last.append(stamp);
      tr.append(
        cell(String(r.id).padStart(2, "0")),
        cell(`${titles.get(r.job) || "Job " + r.job}, ${r.kind}`),
        cell(r.reason),
        cell(near(r.price)),
        cell(!r.pass ? "none" : r.rail === "intents" ? "NEAR Intents" : "NEAR"),
        last,
      );
      return tr;
    });
    for (const [k, n] of Object.entries(counts)) {
      const el = box.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = n;
    }
    rows.replaceChildren(...fresh);
    const note = document.getElementById("chain-note");
    if (note) note.textContent = "Read from the contract just now, in your browser.";
  })().catch(() => {});
})();
