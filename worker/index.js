// The Worker in front of the static site in ../site, and the relay at /mcp.
import relay, { ClanksmithRelay } from "../mcp/worker.mjs";
import { handleRequest } from "./site.mjs";

export { ClanksmithRelay };

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, {
      relay: (next) => relay.fetch(next, env, ctx),
    });
  },
};
