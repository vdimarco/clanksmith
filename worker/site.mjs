// Response rules for the clanksmith.com Worker.
// www and plain HTTP go to https://clanksmith.com.
// /mcp is the relay. Every other path is a static asset from ../site.
// These four headers match site/_headers. run_worker_first returns the Worker
// response, so the Worker sets them again after ASSETS.fetch.

const ASSET_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

const LOCAL = new Set(["localhost", "127.0.0.1"]);

export function isRelayPath(pathname) {
  return pathname === "/mcp" || pathname === "/mcp/";
}

function relayRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/mcp") return request;
  url.pathname = "/mcp";
  return new Request(url, request);
}

export async function handleRequest(request, env, options = {}) {
  const url = new URL(request.url);
  if (!LOCAL.has(url.hostname)) {
    if (url.hostname === "www.clanksmith.com" || url.protocol === "http:") {
      if (url.hostname === "www.clanksmith.com") url.hostname = "clanksmith.com";
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
  }
  if (isRelayPath(url.pathname)) return options.relay(relayRequest(request));
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(ASSET_HEADERS)) response.headers.set(name, value);
  return response;
}
