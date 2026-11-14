// Cloudflare Worker for https://clanksmith.com/mcp.
// One Durable Object per bounty keeps the ledger. Tokens stay in env and are not logged.
import { DurableObject } from "cloudflare:workers";
import { createMarket } from "../market/client.mjs";
import { relayConfig } from "../relay/config.mjs";
import { doName } from "../relay/jobs.mjs";
import { apply, emptyState } from "../relay/service.mjs";
import { handleMcp } from "./http.mjs";

function envRecord(env) {
  return {
    AGENT_MARKET_BASE: env.AGENT_MARKET_BASE,
    AGENT_MARKET_DRY_RUN: env.AGENT_MARKET_DRY_RUN,
    AGENT_MARKET_AGENT_TOKEN: env.AGENT_MARKET_AGENT_TOKEN,
    AGENT_MARKET_BUYER_KEY: env.AGENT_MARKET_BUYER_KEY,
    CLANKSMITH_LIVE_WRITES: env.CLANKSMITH_LIVE_WRITES,
  };
}

export class ClanksmithRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this._tail = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL)");
      const row = this.ctx.storage.sql.exec("SELECT doc FROM ledger WHERE id = 1").toArray()[0];
      if (!row) this.ctx.storage.sql.exec("INSERT INTO ledger (id, doc) VALUES (1, ?)", JSON.stringify(emptyState()));
    });
  }

  load() {
    const row = this.ctx.storage.sql.exec("SELECT doc FROM ledger WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.doc) : emptyState();
  }

  save(state) {
    this.ctx.storage.sql.exec("UPDATE ledger SET doc = ? WHERE id = 1", JSON.stringify(state));
  }

  async op(name, args) {
    const exec = () => this._op(name, args);
    const next = this._tail.then(exec, exec);
    this._tail = next.then(() => undefined, () => undefined);
    return next;
  }

  async _op(name, args) {
    const config = relayConfig(envRecord(this.env));
    const market = createMarket({ config, dryRun: config.dryRun });
    const out = await apply(this.load(), name, args || {}, { market, config, now: () => new Date().toISOString() });
    this.save(out.state);
    return out.result;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    console.log(JSON.stringify({ event: "mcp", method: request.method, path: url.pathname }));
    return handleMcp(request, {
      async dispatch(op, args) {
        if (op === "list_jobs" || op === "get_job") {
          const config = relayConfig(envRecord(env));
          const market = createMarket({ config, dryRun: config.dryRun });
          const out = await apply(emptyState(), op, args, { market, config, now: () => new Date().toISOString() });
          return out.result;
        }
        const jobId = args.job_id || args.jobId;
        if (!jobId) return { ok: false, error: "job_id is required." };
        const stub = env.RELAY.getByName(doName(jobId));
        return stub.op(op, args);
      },
    });
  },
};
