// The Worker in front of the static site in ../site, the relay at /mcp, and the X webhook.
import relay, { ClanksmithRelay } from "../mcp/worker.mjs";
import { handleRequest } from "./site.mjs";

export { ClanksmithRelay };
export { XInbox } from "./x/object.mjs";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, {
      relay: (next) => relay.fetch(next, env, ctx),
    });
  },
};
