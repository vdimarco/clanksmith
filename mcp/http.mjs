// Streamable HTTP handler shared by the Node demo and the Cloudflare Worker.
// One fresh MCP server per request, so nothing about the caller leaks into the next call.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClanksmithServer } from "./clanksmith.mjs";

const MCP_PATHS = new Set(["/mcp", "/mcp/", "/"]);
const MAX_MCP_BODY_BYTES = 128 * 1024;

export function isMcpPath(pathname) {
  return MCP_PATHS.has(pathname);
}

function cors(headers) {
  const next = new Headers(headers);
  next.set("access-control-allow-origin", "*");
  next.set("access-control-allow-headers", "content-type, accept, mcp-protocol-version, mcp-session-id, x-payout-address");
  next.set("access-control-allow-methods", "POST, GET, DELETE, OPTIONS");
  return next;
}

export async function handleMcp(request, { dispatch }) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method === "GET" && url.pathname === "/") {
    return new Response("Clanksmith MCP is at /mcp\n", {
      status: 200,
      headers: cors({ "content-type": "text/plain; charset=utf-8" }),
    });
  }
  if (!isMcpPath(url.pathname)) return new Response("Not found\n", { status: 404, headers: cors({ "content-type": "text/plain; charset=utf-8" }) });

  if (request.method === "POST") {
    const chunks = [];
    let size = 0;
    const reader = request.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_MCP_BODY_BYTES) {
          await reader.cancel();
          return new Response("MCP request too large\n", { status: 413, headers: cors({ "content-type": "text/plain; charset=utf-8" }) });
        }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    request = new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal });
  }

  const payoutAddress = request.headers.get("x-payout-address") || "";
  const server = createClanksmithServer({
    dispatch,
    payoutAddress,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  return new Response(response.body, { status: response.status, headers: cors(response.headers) });
}

export async function nodeToRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_MCP_BODY_BYTES) {
      const error = new Error("MCP request too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || key === "transfer-encoding" || key === "connection" || key === "content-length") continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  const host = req.headers.host || "127.0.0.1";
  const method = req.method || "GET";
  return new Request(`http://${host}${req.url}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

export async function writeNodeResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
