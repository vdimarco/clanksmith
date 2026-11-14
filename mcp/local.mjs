// Local streamable HTTP server. State stays in this process. Market writes follow relayConfig.
import { createServer } from "node:http";
import { createMarket } from "../market/client.mjs";
import { relayConfig } from "../relay/config.mjs";
import { apply, emptyState } from "../relay/service.mjs";
import { handleMcp, nodeToRequest, writeNodeResponse } from "./http.mjs";

export async function startLocal({ port = 0, state, env = {}, fetchImpl, now } = {}) {
  const config = relayConfig(env);
  const market = createMarket({ config, dryRun: config.dryRun, fetchImpl });
  const holder = { state: state ?? emptyState(), market, config };
  const clock = now || (() => new Date().toISOString());

  async function dispatch(op, args) {
    const out = await apply(holder.state, op, args, { market, config, now: clock });
    holder.state = out.state;
    return out.result;
  }

  const server = createServer(async (req, res) => {
    try {
      const request = await nodeToRequest(req);
      const response = await handleMcp(request, { dispatch });
      await writeNodeResponse(res, response);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("MCP request failed\n");
      console.error(JSON.stringify({ event: "mcp_error", message: String(err?.message || err).slice(0, 200) }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    holder,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}
