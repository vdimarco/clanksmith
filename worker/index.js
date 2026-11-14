// The Worker in front of the static site in ../site.
// It sends www and plain HTTP to https://clanksmith.com, then serves the
// asset and adds the security and cache headers.

const SECURITY = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; " +
    "connect-src 'self' https://rpc.mainnet.fastnear.com https://rpc.testnet.fastnear.com; " +
    "base-uri 'none'; form-action https://x.com; frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const BOARD_CSP = SECURITY["content-security-policy"].replace(
  "https://rpc.mainnet.fastnear.com https://rpc.testnet.fastnear.com",
  "https:",
);

const LOCAL = new Set(["localhost", "127.0.0.1"]);

function cacheFor(pathname, status, type) {
  if (status !== 200) return "no-store";
  if (pathname.startsWith("/fonts/")) return "public, max-age=31536000, immutable";
  if (/^(text\/html|text\/javascript|text\/css|application\/json)/.test(type)) return "public, max-age=300";
  return "public, max-age=86400";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!LOCAL.has(url.hostname)) {
      if (url.hostname === "www.clanksmith.com" || url.protocol === "http:") {
        if (url.hostname === "www.clanksmith.com") url.hostname = "clanksmith.com";
        url.protocol = "https:";
        return Response.redirect(url.toString(), 301);
      }
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(SECURITY)) response.headers.set(name, value);
    if (url.pathname.startsWith("/board/")) {
      response.headers.set("content-security-policy", BOARD_CSP);
    }
    if (asset.status === 200 || asset.status === 404) {
      response.headers.set("cache-control", cacheFor(url.pathname, asset.status, asset.headers.get("content-type") || ""));
    }
    return response;
  },
};
