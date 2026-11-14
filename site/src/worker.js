// clanksmith.com Worker. Static assets for the site, /mcp for the relay.
import relay, { ClanksmithRelay } from "../../mcp/worker.mjs";
import { apexRedirect, isRelayPath } from "./route.mjs";

export { ClanksmithRelay };

function relayRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/mcp") return request;
  url.pathname = "/mcp";
  return new Request(url, request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const apex = apexRedirect(url);
    if (apex) return Response.redirect(apex.toString(), 301);
    if (isRelayPath(url.pathname)) return relay.fetch(relayRequest(request), env, ctx);
    return env.ASSETS.fetch(request);
  },
};
