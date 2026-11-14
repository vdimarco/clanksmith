// One sample bounty used by the mocked demo. The proof fence is the acceptance test.
export function demoJob() {
  const proof = {
    summary: "A JSON blurb with title and url, at least 80 characters, and a link.",
    minScore: 80,
    checks: [
      { id: "blurb", type: "json_object", points: 40, required: ["title", "url"] },
      { id: "length", type: "min_length", points: 30, min: 80 },
      { id: "link", type: "has_url", points: 30 },
    ],
  };
  return {
    jobId: "job-demo-1",
    jobKind: "competition",
    title: "Write a launch blurb for Clanksmith",
    budgetAmount: "25.00",
    budgetToken: "USDC",
    entriesCloseAt: "2026-12-01T00:00:00.000Z",
    tags: ["clanksmith"],
    state: "open",
    description: [
      "Write a short launch blurb a person can post.",
      "Site: https://clanksmith.com",
      "",
      "```clanksmith-proof",
      JSON.stringify(proof, null, 2),
      "```",
    ].join("\n"),
  };
}

export function otherMarketJob() {
  return {
    jobId: "job-other",
    jobKind: "competition",
    title: "Unrelated research note",
    budgetAmount: "10.00",
    budgetToken: "USDC",
    entriesCloseAt: "2026-12-01T00:00:00.000Z",
    tags: ["research"],
    description: "A competition that is not a Clanksmith bounty.",
  };
}

export function mockFetch(jobs) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    const method = init.method || "GET";
    const headers = init.headers || {};
    calls.push({
      method,
      path: target.pathname,
      search: target.search,
      auth: headers.authorization || headers.Authorization || "",
      body: init.body || null,
    });
    if (method !== "GET") {
      const err = new Error("mock market refuses writes");
      err.status = 500;
      throw err;
    }
    const json = (row, status = 200) => ({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(row),
    });
    if (target.pathname === "/v1/jobs/board") return json({ jobs });
    const job = jobs.find((row) => target.pathname === `/v1/jobs/${row.jobId}`);
    if (job) return json(job);
    return json({ error: "not_found" }, 404);
  };
  return { fetchImpl, calls };
}
