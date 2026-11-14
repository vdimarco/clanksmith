# Clanksmith on Agent Market

The site is https://clanksmith.com.

An X reply to @clanksmith becomes a job on [Agent Market](https://market.near.ai). Clanksmith awards a bid only inside a budget cap, and accepts the deliverable only after the same check the NEAR contract runs. A failed check requests changes. A second failure opens a market dispute and prepares the existing appeal hash. Nothing in this folder signs a NEAR transaction or posts to X.

`AGENT_MARKET_DRY_RUN` defaults on. Mutating calls are planned and not sent.

## What the owner creates

Do not call `POST /v1/agents/register`. That route mints an `aat_` seller token for a new account, and that token cannot hire.

### Seller token, `AGENT_MARKET_AGENT_TOKEN`

This is the `aat_` token. It polls, starts, and submits. It cannot create a job, award a bid, or accept a delivery.

1. Sign in at https://market.near.ai and confirm the email. Google sign-in counts as confirmed.
2. Open Building, Your agents, New agent.
3. Name it Clanksmith. Set the handle to `clanksmith`. Tagline: Hire an AI agent with an X reply. Pays only on proof, settled on NEAR. Description: Clanksmith turns a reply to @clanksmith into a checked job. The site is https://clanksmith.com. Under Hosting, choose Self-hosted and leave the webhook empty.
4. Set a price and a delivery window.
5. On Agent API tokens, click Create token. Copy the `aat_` value once. Put it in `AGENT_MARKET_AGENT_TOKEN`.
6. Leave the listing as a draft until a test run on the agent page looks right, then set Listing status to Live.

### Buyer credential, `AGENT_MARKET_BUYER_KEY`

Creating a job, awarding a bid, accepting a delivery, requesting changes, and opening a dispute belong to the account, not to an agent token. The docs call this out on the [agent API reference](https://market.near.ai/skill/reference/agent-api.md): those actions are not on the `aat_` surface.

The credential that can do them is an OAuth access token for the account itself:

1. Use the same confirmed account. Top up USDC. An award holds the bid amount from that balance. Accept releases it. The code refuses a bid above `AGENT_MARKET_BUDGET_CAP` (default `0.50`).
2. Connect an MCP client as yourself, not as the agent. The buyer endpoint that spends in the call is `https://market.near.ai/mcp/pro`. The endpoint `https://market.near.ai/mcp` only returns a job-page link for award and accept.
3. Approve the consent screen as yourself. The client stores the access token from `https://market.near.ai/oauth/token`.
4. Copy that access token into `AGENT_MARKET_BUYER_KEY`. Clanksmith sends it as `Authorization: Bearer` on `/v1`.

A browser session cookie is the other account credential the API describes. Prefer the OAuth bearer. Do not put either value in the repo.

## Flow

1. `parseMention` reads the reply (`@clanksmith make me a logo, 0.2 NEAR`).
2. If the amount is above the budget cap, Clanksmith stops.
3. `POST /v1/jobs` opens the board job. The brief names the kind, the spec, and the on-chain contract. The posted budget is the cap when the mention is higher.
4. `GET /v1/jobs/{id}/bids` lists bids. The lowest pending bid at or under the cap is the one that would be awarded.
5. `POST /v1/jobs/{id}/award` with `{ "bidId" }` holds that amount. Dry run records this call and does not send it.
6. The on-chain `post_job` title is `logo mkt:<market job id>`, at most 80 characters. `chain.html` already prints that title, so the ledger shows the market id. This package does not sign that transaction.
7. When the deliverable arrives, Clanksmith runs the contract check on the JSON fence.
8. Pass: `POST /v1/assignments/{id}/accept`, which releases the hold.
9. Fail on the first delivery: `POST /v1/assignments/{id}/request-changes`, which stops the acceptance window from paying on silence.
10. Fail again: `POST /v1/assignments/{id}/dispute`. The same result prepares an appeal evidence hash for the existing jury when an on-chain receipt is present. The appeal is not submitted here.

The seller loop is `market/worker.mjs`. It polls `GET /v1/agents/me/assignments` with the `aat_` token, calls `start` on a fresh hire, and `submit` with Markdown. A buyer message on an in-progress row that already has `submittedAt` is rework, and the next submit answers it.

## Commands

```sh
node market/test/all.mjs
node market/test/live.mjs
```

`all.mjs` uses a fake network. `live.mjs` calls `GET /v1/agents?limit=1`, which is public, and `GET /v1/jobs/board?limit=1`, which is read-only. Neither call creates a job.

## Untested until the owner mints the keys

Award, accept, request-changes, and dispute were confirmed as routes (an unsigned call is rejected before it can write). Their JSON fields follow the public schema (`bidId`, `feedback`, `reason`) and have not been accepted by the server. The OAuth bearer has not been tried against `/v1`. No USDC has moved. No on-chain `post_job` has been signed. The seller loop has not polled a real assignment.
