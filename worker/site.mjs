// Response rules for the clanksmith.com Worker.
// www and plain HTTP go to https://clanksmith.com.
// /mcp is the relay. /x/webhook and /x/review are the X reply inbox.
// Every other path is a static asset from ../site.
import { collectJobs, jobsResponse } from "./x/boardjob.mjs";
import { handleX } from "./x/handle.mjs";

const SECURITY = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy":
    "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
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

export function isRelayPath(pathname) {
  return pathname === "/mcp" || pathname === "/mcp/";
}

function relayRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/mcp") return request;
  url.pathname = "/mcp";
  return new Request(url, request);
}

async function boardInbox(env) {
  if (!env?.X_INBOX) return null;
  const { durableInbox } = await import("./x/object.mjs");
  return durableInbox(env.X_INBOX);
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
  if (url.pathname === "/x/webhook" || url.pathname === "/x/review") return handleX(request, env, options);
  if (url.pathname === "/jobs" || url.pathname.startsWith("/jobs/")) {
    const inbox = options.jobsInbox || await boardInbox(env);
    const page = jobsResponse(url.pathname, await collectJobs(inbox));
    if (page) {
      const response = new Response(page.body, {
        status: page.status,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": page.cache },
      });
      for (const [name, value] of Object.entries(SECURITY)) response.headers.set(name, value);
      return response;
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
}
