// One inbox for @clanksmith. Storage claims are transactional, so a webhook retry
// cannot pass the dedupe check twice.
import { DurableObject } from "cloudflare:workers";
import { addReview, allowSubmit, claimReply, listBoardJobs, listReviews, listSubmissionIds, readBoardJob, readListing, readSubmission, readSubmissionKey, releaseClaim, remember, storeBoardJob, storeListing, storeSubmission, storeSubmissionKey } from "./inbox.mjs";
import { createTokenKeeper } from "./token.mjs";

export class XInbox extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json() : null;
    if (url.pathname === "/claim") return Response.json(await claimReply(this.ctx.storage, body));
    if (url.pathname === "/release") {
      await releaseClaim(this.ctx.storage, body.id);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/remember") return Response.json(await remember(this.ctx.storage, body));
    if (url.pathname === "/review") {
      await addReview(this.ctx.storage, body);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/reviews") return Response.json(await listReviews(this.ctx.storage));
    if (url.pathname === "/listing" && request.method === "GET") {
      return Response.json({ record: await readListing(this.ctx.storage, url.searchParams.get("source") || "") });
    }
    if (url.pathname === "/listing" && request.method === "POST") {
      return Response.json(await storeListing(this.ctx.storage, body));
    }
    if (url.pathname === "/board-jobs" && request.method === "GET") {
      return Response.json({ jobs: await listBoardJobs(this.ctx.storage) });
    }
    if (url.pathname === "/board-job" && request.method === "GET") {
      return Response.json({ job: await readBoardJob(this.ctx.storage, url.searchParams.get("source") || "") });
    }
    if (url.pathname === "/board-job" && request.method === "POST") {
      return Response.json(await storeBoardJob(this.ctx.storage, body));
    }
    if (url.pathname === "/submit-allow" && request.method === "POST") {
      return Response.json({ ok: await allowSubmit(this.ctx.storage, body.key, body.now) });
    }
    if (url.pathname === "/submission" && request.method === "GET") {
      return Response.json({ record: await readSubmission(this.ctx.storage, url.searchParams.get("id") || "") });
    }
    if (url.pathname === "/submission" && request.method === "POST") {
      await storeSubmission(this.ctx.storage, body);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/submission-index") return Response.json({ ids: await listSubmissionIds(this.ctx.storage) });
    if (url.pathname === "/submission-key" && request.method === "GET") {
      return Response.json({ record: await readSubmissionKey(this.ctx.storage, url.searchParams.get("key") || "") });
    }
    if (url.pathname === "/submission-key" && request.method === "POST") {
      await storeSubmissionKey(this.ctx.storage, body.key, body.id);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/oauth/access") {
      const accessToken = await this.tokens().accessToken(body || {});
      return Response.json({ accessToken });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  tokens() {
    if (!this.keeper) {
      this.keeper = createTokenKeeper({
        storage: this.ctx.storage,
        env: this.env,
        now: () => Date.now(),
      });
    }
    return this.keeper;
  }
}

export function durableInbox(namespace) {
  const stub = namespace.get(namespace.idFromName("clanksmith"));
  const call = async (path, body) => {
    const res = await stub.fetch("https://x-inbox" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };
  return {
    claim: (opts) => call("/claim", opts),
    release: (id) => call("/release", { id }),
    remember: (opts) => call("/remember", opts),
    review: (item) => call("/review", item),
    reviews: () => call("/reviews"),
    getListing: (sourcePostId) => call("/listing?source=" + encodeURIComponent(sourcePostId)).then((body) => body.record || null),
    saveListing: (record) => call("/listing", record),
    getBoardJob: (sourcePostId) => call("/board-job?source=" + encodeURIComponent(sourcePostId)).then((body) => body.job || null),
    listBoardJobs: () => call("/board-jobs").then((body) => body.jobs || []),
    saveBoardJob: (job) => call("/board-job", job),
    allowSubmit: (key, now) => call("/submit-allow", { key, now }).then((body) => body.ok === true),
    saveSubmission: (record) => call("/submission", record),
    getSubmission: (id) => call("/submission?id=" + encodeURIComponent(id)).then((body) => body.record || null),
    listSubmissionIds: () => call("/submission-index").then((body) => body.ids || []),
    getSubmissionKey: (key) => call("/submission-key?key=" + encodeURIComponent(key)).then((body) => body.record || null),
    saveSubmissionKey: (key, id) => call("/submission-key", { key, id }),
    accessToken: (opts = {}) => call("/oauth/access", opts).then((body) => body.accessToken || null),
  };
}
