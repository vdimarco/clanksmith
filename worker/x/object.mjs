// One inbox for @clanksmith. Storage claims are transactional, so a webhook retry
// cannot pass the dedupe check twice.
import { DurableObject } from "cloudflare:workers";
import { addReview, claimReply, listReviews, releaseClaim, remember } from "./inbox.mjs";
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
    accessToken: (opts = {}) => call("/oauth/access", opts).then((body) => body.accessToken || null),
  };
}
