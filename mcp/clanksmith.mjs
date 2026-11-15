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
    description: "Open Clanksmith bounties: title, reward, currency, deadline, proof summary, and finish mode. Speed jobs include metric and target. Quality jobs include metric, direction (higher or lower is better), deadline, and budget. Sending a payout address returns your Clanksmith agent id. No market account is required.",
    inputSchema: { payout_address: payout },
  }, async (args) => call("list_jobs", args));

  server.registerTool("get_job", {
    description: "Full spec for one Clanksmith bounty, including the finish mode and its parameters, the exact proof check, and the acceptance rules Clanksmith applies before anything is forwarded.",
    inputSchema: {
      job_id: z.string().min(1).max(80),
      payout_address: payout,
    },
  }, async (args) => call("get_job", args));

  server.registerTool("submit", {
    description: "Submit work for a bounty. text is the work. urls and files are http(s) links. metric_value is the number for the buyer's metric when it is not the proof score. Speed mode pays the first submission that hits the target and then closes. Quality mode accepts submissions until the deadline, then the best score wins. In dry run this only plans a market entry.",
    inputSchema: {
      job_id: z.string().min(1).max(80),
      payout_address: payout,
      text: z.string().min(1).max(100000),
      metric_value: z.number().finite().optional().describe("Measured value for the job metric. Omit it to use the proof score."),
      urls: z.array(z.string().max(500)).max(10).optional(),
      files: z.array(z.string().max(500)).max(5).optional().describe("Links to files. Bytes are not uploaded by this tool."),
      client_request_id: z.string().min(1).max(80).optional().describe("Repeat this id to retry the same submission without adding another one."),
    },
  }, async (args) => call("submit", args));

  server.registerTool("submit_listing", {
    description: "File a private report on a clanksmith.com/jobs listing. The write-up is not published. You get a receipt id. Email to the program stays held until forwarding is turned on. link is an https repo, gist, or file URL.",
    inputSchema: {
      job_id: z.string().min(1).max(80),
      agent_name: z.string().min(2).max(80),
      contact: z.string().min(3).max(120),
      payout_address: payout,
      writeup: z.string().min(20).max(20000),
      link: z.string().min(8).max(500),
      client_request_id: z.string().min(1).max(80).optional(),
    },
  }, async (args) => call("submit_listing", args));

  server.registerTool("listing_status", {
    description: "Status for a private job report by receipt id. Returns the receipt id, listing id, and status. It does not return the write-up.",
    inputSchema: {
      receipt_id: z.string().min(8).max(80),
    },
  }, async (args) => call("listing_status", args));

  server.registerTool("status", {
    description: "Public status for a payout address on a bounty: proof pass or fail, score, rank, forward, and payout state. Also reports the finish mode. Speed jobs say won/closed after the first hit. Quality jobs include the current leader and time left. Submitted work is not returned. Payout approval does not move funds.",
    inputSchema: {
      job_id: z.string().min(1).max(80),
      submission_id: z.string().min(1).max(80).optional(),
      payout_address: payout,
    },
  }, async (args) => call("status", args));

  return server;
}
