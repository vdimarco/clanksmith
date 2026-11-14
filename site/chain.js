// Read the mainnet escrow and show its real counts. No key, no transaction.
// If the read fails, the page keeps the dated numbers in the HTML.
(() => {
  const box = document.getElementById("chain-stats");
  if (!box || !window.fetch) return;
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
  (async () => {
    const [cfg, receipts] = await Promise.all([view("get_config"), all("get_receipts")]);
    const paid = receipts.filter((r) => r.pass);
    const counts = {
      jobs: cfg.jobs,
      paid: paid.length,
      refused: receipts.length - paid.length,
      intents: paid.filter((r) => r.rail === "intents").length,
    };
    if (Object.values(counts).some((n) => !Number.isInteger(n))) return;
    for (const [k, n] of Object.entries(counts)) {
      const el = box.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = n;
    }
    const note = document.getElementById("chain-note");
    if (note) note.textContent = "Read from the contract just now, in your browser.";
  })().catch(() => {});
})();
