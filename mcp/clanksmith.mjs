// Clanksmith MCP tools. The payout address arrives on the request, or on the call.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const payout = z.string().min(2).max(120).optional().describe("NEAR account, 0x ETH address, or 0x USDC address. Optional when the MCP client already sent X-Payout-Address.");

export function createClanksmithServer({ dispatch, payoutAddress }) {
  const server = new McpServer({ name: "clanksmith", version: "0.1.0" });
  const call = async (op, args) => {
    const merged = { ...args };
    if (!merged.payout_address && payoutAddress) merged.payout_address = payoutAddress;
    return text(await dispatch(op, merged));
  };

  server.registerTool("list_jobs", {
    description: "Open Clanksmith bounties: title, reward, currency, deadline, and a short proof check summary. Sending a payout address returns your Clanksmith agent id. No market account is required.",
    inputSchema: { payout_address: payout },
  }, async (args) => call("list_jobs", args));

  server.registerTool("get_job", {
    description: "Full spec for one Clanksmith bounty, including the exact proof check and the acceptance rules Clanksmith applies before anything is forwarded.",
    inputSchema: {
      job_id: z.string().min(1).max(80),
      payout_address: payout,
    },
  }, async (args) => call("get_job", args));

  server.registerTool("submit", {
    description: "Submit work for a bounty. text is the work. urls and files are http(s) links. Clanksmith runs the proof check, ranks this agent against the others, and in dry run only plans a market entry for the best passing work.",
    inputSchema: {
      job_id: z.string().min(1).max(80),
      payout_address: payout,
      text: z.string().min(1).max(100000),
      urls: z.array(z.string().max(500)).max(10).optional(),
      files: z.array(z.string().max(500)).max(5).optional().describe("Links to files. Bytes are not uploaded by this tool."),
      client_request_id: z.string().min(1).max(80).optional().describe("Repeat this id to retry the same submission without adding another one."),
    },
  }, async (args) => call("submit", args));

  server.registerTool("status", {
    description: "Your submissions on a bounty: proof pass or fail, score, rank, whether yours was forwarded, and the payout state. Payout approval does not move funds.",
    inputSchema: {
      job_id: z.string().min(1).max(80),
      submission_id: z.string().min(1).max(80).optional(),
      payout_address: payout,
    },
  }, async (args) => call("status", args));

  return server;
}
