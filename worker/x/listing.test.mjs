import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryInbox } from "./inbox.mjs";
import { readBrief } from "./brief.mjs";
import { createListing, listingMode, liveListingBlock, marketBody } from "./listing.mjs";

const BOUNTY = "Aktionariat's contract bounty pays 3 ETH for high-impact bugs (takeover or drain of a token, market or payment hub) and 1 ETH for medium. Email bugs@aktionariat.com with a Hardhat PoC against master. github.com/aktionariat/contracts";

function brief() {
  return readBrief({
    id: "2122006059141263643",
    username: "proto_von",
    text: "@W3B_AI_SR @clanksmith check out the above",
    parentId: "2121989097954697556",
    parentText: BOUNTY,
    parentUsername: "W3B_AI_SR",
  });
}

test("listing mode defaults to off", () => {
  assert.equal(listingMode({}), "off");
  assert.equal(listingMode({ X_MARKET_LISTINGS: "dry-run" }), "dry-run");
  assert.equal(listingMode({ X_MARKET_LISTINGS: "LIVE" }), "live");
  assert.equal(listingMode({ X_MARKET_LISTINGS: "yes" }), "off");
});

test("a third-party ETH bounty is not sent as a competition that escrows USDC", () => {
  const body = marketBody(brief());
  assert.equal(body.poolAmount, undefined);
  assert.equal(body.budgetAmount, undefined);
  assert.equal(body.path, "/v1/jobs");
  assert.match(body.description, /Paid by Aktionariat/);
  assert.match(body.description, /not by @proto_von/);
  assert.match(body.description, /3 ETH/);
  assert.match(body.description, /1 ETH/);
  assert.match(body.description, /bugs@aktionariat.com/);
  assert.match(body.description, /2121989097954697556/);
  assert.equal(body.description.includes("poolAmount"), false);
  assert.equal(liveListingBlock(brief(), { AGENT_MARKET_BUYER_KEY: "buyer-secret" }), "external-bounty-not-escrowed");
  assert.equal(body.description.includes("buyer-secret"), false);
});

test("dry-run records one job per source post and the reply can link it", async () => {
  const inbox = createMemoryInbox();
  const calls = [];
  const market = {
    async post(path, body, auth) {
      calls.push({ path, body, auth });
      return { dryRun: true, method: "POST", path, body, auth };
    },
  };
  const first = await createListing({
    brief: brief(),
    mode: "dry-run",
    market,
    inbox,
    now: Date.parse("2026-11-15T16:40:00.000Z"),
  });
  const second = await createListing({
    brief: { ...brief(), tagger: "someone_else" },
    mode: "dry-run",
    market,
    inbox,
    now: Date.parse("2026-11-15T16:41:00.000Z"),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/jobs");
  assert.equal(calls[0].auth, "buyer");
  assert.equal(calls[0].body.poolAmount, undefined);
  assert.equal(first.dryRun, true);
  assert.equal(first.replayed, false);
  assert.equal(first.jobId, "dry-run-2121989097954697556");
  assert.equal(first.url, "https://market.near.ai/jobs/dry-run-2121989097954697556");
  assert.equal(first.payerName, "Aktionariat");
  assert.equal(first.payerKind, "third-party");
  assert.equal(second.replayed, true);
  assert.equal(second.url, first.url);
  assert.equal(JSON.stringify(first).includes("buyer-secret"), false);
});

test("live mode does not post a third-party ETH bounty", async () => {
  let calls = 0;
  const result = await createListing({
    brief: brief(),
    mode: "live",
    env: { AGENT_MARKET_BUYER_KEY: "buyer-secret" },
    market: { post: async () => { calls += 1; return { jobId: "should-not-send" }; } },
    inbox: createMemoryInbox(),
    now: Date.parse("2026-11-15T16:40:00.000Z"),
  });
  assert.equal(calls, 0);
  assert.equal(result.sent, false);
  assert.equal(result.reason, "external-bounty-not-escrowed");
  assert.equal(result.url, "");
  assert.equal(JSON.stringify(result).includes("buyer-secret"), false);
});
