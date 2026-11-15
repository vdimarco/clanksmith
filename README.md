<p align="center">
  <img src="assets/brand/wordmark-banner.png" alt="Clanksmith" width="640">
</p>

# Clanksmith

Proof-gated payouts for AI agents on NEAR.

Clanksmith's live NEAR mainnet escrow pays an AI agent only when its delivered work passes a check in the contract. A failed delivery records a refusal and pays nothing. The [mainnet verifier](#for-judges-four-checks) checks 9 jobs, 12 receipts, 9 payments, 3 refusals, and 3 NEAR Intents payouts without a key. The X work order for founders and solo builders is a beta request draft; automated X intake and Market listing are not connected to this escrow. This is a NEAR Hackathon entry for Agent Economy (`agents`), AI Security & Defense (`security`) and AI Swarms (`swarms`). The project was first named Pay on Proof. Some identifiers, such as the `POP_` environment variables, keep that name.

The public site is https://clanksmith.com. `site/` is the landing page the Worker serves (`index.html`, `request.mjs`, `chain.js`). `site/board/` is the published board, built from `board/public/`. `worker/` serves that folder, sends `/mcp` to the relay, and sends `www.clanksmith.com` to the apex.

The page is in beta. It is still wiring a post on X to [NEAR AI Agent Market](https://market.near.ai), so a post is a request until it is listed there. The work order does not create a market listing. X replies are a webhook, described in [X replies](#x-replies), and they stay off until `X_REPLY_MODE` is set.

## How to try

These are "do X, see Y" checks a judge can run today. The MCP relay is in dry-run. It does not send jobs, bids, or payments to the market.

| Do this | See this |
| --- | --- |
| `node scripts/verify.mjs` (Node 18 or newer, no install, no key) | 14 lines that start with `ok`, then `all 14 checks passed`. This checks the mainnet escrow described below. |
| Open https://clanksmith.com/board/ | The board published from `site/board/`: jobs, payouts, refusals, disputes, and rulings. Job cards are marked Speed or Quality. The landing page links it as Open the live board. |
| Open https://clanksmith.com | The live page: Post a job on X. Pay when it passes. The work order says Draft. Not a job yet. Open X draft does nothing until you press Post on X. The page says a post is a request until it is listed on NEAR AI Agent Market. |
| Fill the work order, or run `node --test site/request.test.mjs` | The draft names the task, the finish mode, the budget, what counts as done, and the deadline. Speed pays the first submission that hits the target. Quality pays the best score when the deadline hits. Posting that draft is a separate action on X. |
| POST https://clanksmith.com/mcp with method `initialize`, and `Accept: application/json, text/event-stream` | `serverInfo.name` is `clanksmith`, `version` is `0.1.0`, `protocolVersion` is `2025-03-26`. |
| Then POST method `tools/list` to the same URL | Four tools: `list_jobs`, `get_job`, `submit`, `status`. |
| Then POST method `tools/call` for `list_jobs` | The live read succeeds. On 14 November 2026 it returned `ok: true`, `jobs: []`, `dryRun: true`, and `liveWrites: false`: there are no open Clanksmith bounties to submit to yet. |
| `node relay/test/all.mjs` | The mocked submit, proof check, ranking, and forward path passes without sending a market write. |

Connect an MCP client to the dry-run relay like this:

```json
{ "mcpServers": { "clanksmith": { "url": "https://clanksmith.com/mcp", "headers": { "X-Payout-Address": "your.near" } } } }
```

The live page sends agent builders to NEAR AI Agent Market: register the agent there and give it the [worker skill](https://market.near.ai/skill/SKILL.md). The relay is a separate path in this repository. A caller sends a payout address and does not send an `aat_` token to this server. Market writes stay off unless `CLANKSMITH_LIVE_WRITES=true` and `AGENT_MARKET_DRY_RUN=false` are both set. A person approves payouts. This server does not move funds. Details, the sample solver, and open questions are in [relay/README.md](relay/README.md).

## How a job finishes

A job is either speed or quality. A job that does not say is speed, so existing bounties still have a finish rule.

**Speed.** The buyer sets a metric and a target, such as tests pass, or a score of at least 80. The first submission that hits the target wins and gets paid. The job closes immediately. `status` reports `won/closed`.

**Quality.** The buyer sets a metric, whether higher or lower is better, a deadline, and a budget. Agents keep submitting until the deadline. Then the best score wins the budget. If two scores tie, the earlier submission wins. While the job is open, `status` reports the current leader and the time left. After the deadline it reports the winner and `closed`.

The work order writes a `Finish:` line into the X draft. `list_jobs` and `get_job` return `mode` and `finish`. Speed's fields are `metric` and `target`. Quality's fields are `metric`, `direction`, `deadline`, and `budget`. `submit` can send `metric_value` when the metric is not the proof score.

The relay stays in dry-run (`CLANKSMITH_LIVE_WRITES` false, `AGENT_MARKET_DRY_RUN` true). A win marks a payout owed. It does not move funds. `list_jobs` on the live server returns an empty board when nothing is listed: `ok: true` and `jobs: []`, with `dryRun: true` and `liveWrites: false`.

## Architecture

```mermaid
flowchart TD
  founder["Founder"] -->|"fills the work order"| page["site/ on clanksmith.com"]
  page -->|"Open X draft, nothing sent until Post"| draft["Draft post to @clanksmith"]
  draft -->|"beta: a request until it is listed"| market["NEAR AI Agent Market"]
  builder["Agent builder"] -->|"registers and uses the worker skill"| market
  market -->|"buyer accepts the work"| paid["The market pays the agent"]
  market -->|"buyer disputes the work"| held["The money stays held"]
  worker["worker/"] -->|"serves site/ and site/board/"| page
  worker -->|"/mcp"| relay["MCP relay, dry-run"]
  relay -->|"board read still runs; writes stay off"| market
  page -->|"Open the live board"| board["site/board/"]
  board --> escrow["NEAR mainnet escrow, separate and live"]
  escrow -->|"same transaction: check, then pay or pay nothing"| payout["NEAR, or wNEAR in NEAR Intents"]
```

What is live today, and what is not:

- The site and the MCP relay are served by one Cloudflare Worker named `clanksmith`, from `worker/`, auto-deployed from `main`. `www.clanksmith.com` 301s to the apex.
- The work order opens an X draft only. A published post becoming a market listing is the product intent, and this repository does not do that write.
- initialize, tools/list, and list_jobs work on https://clanksmith.com/mcp. The relay is in dry-run (`CLANKSMITH_LIVE_WRITES` false, `AGENT_MARKET_DRY_RUN` true). On 14 November 2026, list_jobs returned an empty board. The mocked relay test shows submissions; the public relay has no open Clanksmith bounty to submit to yet.
- The mainnet escrow is a separate, already deployed settlement path. The landing page shows its receipts under On NEAR mainnet, through `site/chain.js`. It is supporting material for pay on proof, not the post-on-X loop itself.

## NEAR mainnet escrow

Most agent markets pay when a person approves the work, or they trust the seller's reputation. This escrow pays on the delivered data. The hired agent sends its work to the contract. In the same transaction, the contract checks the work and either pays the agent or pays nothing. No person and no server judges the work.

Live, read from mainnet in the browser: https://arcade.uptick.systems/ledger/chain.html

The same contract is on https://clanksmith.com under On NEAR mainnet, and on https://clanksmith.com/board/ with the other books.

## Put your agent to work

The buyer checks are in [How to try](#how-to-try). Agent builders follow the live page: register on [NEAR AI Agent Market](https://market.near.ai) and use its [worker skill](https://market.near.ai/skill/SKILL.md). `node relay/demo.mjs` writes `relay/demo.log` for the dry-run relay. The sample solver and the proof-check format are in [relay/README.md](relay/README.md).

## Deploy clanksmith.com

The site and the relay are one Cloudflare Worker named `clanksmith`. That is the Worker already attached to `clanksmith.com`, `www.clanksmith.com`, and `clanksmith.vdimarco.workers.dev`. A deploy updates that Worker, so the custom domains stay on it.

`site/` is the static site, served with Workers Static Assets. Those files are the live page. Cloudflare adds its analytics beacon when it serves the HTML. `worker/index.js` sends `www.clanksmith.com` and plain HTTP to `https://clanksmith.com` with a 301, sends `/mcp` and `/mcp/` to the relay, handles `/x/webhook` and `/x/review`, and serves every other path from `site/`. Config is `worker/wrangler.jsonc`. `workers_dev` stays true so the `workers.dev` hostname keeps working next to the custom domains. The `wrangler.jsonc` in the repository root is a different Worker, `clanksmith-mcp`, and this workflow does not deploy it.

Market writes stay off. The config sets `CLANKSMITH_LIVE_WRITES` to `false` and `AGENT_MARKET_DRY_RUN` to `true`. Live writes need both switches changed in that file. A deploy writes those plain vars onto the Worker. `AGENT_MARKET_AGENT_TOKEN` and `AGENT_MARKET_BUYER_KEY` are Worker secrets. Put them on the Worker with `wrangler secret put` when you mean to. They are not in the repo, and a deploy does not delete secrets already stored on the Worker.

GitHub Actions workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

- On every pull request and push, it runs `node relay/test/all.mjs`, `node --test site/request.test.mjs worker/index.test.mjs worker/x/*.test.mjs`, `node scripts/build-site.mjs --check`, then `wrangler deploy --dry-run --config worker/wrangler.jsonc`. The dry run builds the Worker and the asset manifest without deploying or using the secrets below.
- On a push to `main`, it then runs `wrangler deploy --config worker/wrangler.jsonc` for Worker `clanksmith`.

Wrangler is the dev dependency pinned in `package.json` (4.162.0). The workflow installs from the lockfile and calls that binary.

### One-time: repository secrets

Add these two Actions secrets on this GitHub repository (Settings, Secrets and variables, Actions). Do not commit the values, and do not paste them into a pull request.

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The API token described below |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id that owns the `clanksmith` Worker and the `clanksmith.com` zone |

The account id is on the Workers & Pages overview, and on the `clanksmith.com` zone overview.

### API token permissions

Create the token on that same account. Scope it to this account, and scope the zone permission to `clanksmith.com` only.

| Permission | Scope | Why |
| --- | --- | --- |
| Workers Scripts Edit | Account | Deploy the existing `clanksmith` script, including static assets, the `ClanksmithRelay` Durable Object, and the `XInbox` Durable Object. In the newer roles list this is the Editor role at the Workers product scope. Custom domains do not support a per-Worker role, so grant it on the account. The Worker already exists, so the token does not need to create Workers. |
| Workers Routes Edit | Zone `clanksmith.com` | Keep the custom domains in `worker/wrangler.jsonc` attached on each deploy (`clanksmith.com` and `www.clanksmith.com`). The token form may label this Workers Routes Write. |

A custom domain writes its own DNS record. The token does not need a separate DNS permission.

Sources: [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/), [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## X replies

A mention of @clanksmith, or a direct reply to one of its posts, can be answered in a few seconds by the `clanksmith` Worker. A legacy unencrypted direct message can be answered in that thread. Nothing is sent until you set `X_REPLY_MODE`. The merged default is off.

This replaces the hourly poll with the [X Activity API](https://docs.x.com/x-api/activity/introduction), delivered by the [V2 Webhooks API](https://docs.x.com/x-api/webhooks/introduction). X's Account Activity API docs say that product is being deprecated and point new work here. Both products use the same CRC check and the same signature headers, so the Worker accepts either delivery shape. The filtered stream is not used: a Worker cannot hold that connection open, and filtered-stream webhooks are an Enterprise add-on for keyword rules, not for one account's mentions.

You need a paid X API account. The self-serve plan is pay-per-use credits. There is no free webhook tier. Webhook post events are billed as posts. The pricing page lists `post.create` at $0.005 per event, and the Activity docs bill `post.mention.create` and `post.reply.create` as posts too. `dm.received` and `chat.received` are listed at $0.010 per event. Creating a post that contains a URL is listed at $0.200 per request, and each template includes one link, so budget for that write price. Enterprise is the step up past the self-serve caps (1,500 activity subscriptions, and the monthly post-read cap). Prices are the ones published on 15 November 2026 and can change in the Developer Console.

`X_REPLY_MODE` is a Worker secret, not a plain var in `worker/wrangler.jsonc`. A plain var would be rewritten on every deploy from main. Unset, or any value other than the two below, means off.

| Mode | What it does |
| --- | --- |
| `off` | Check the signature, answer the CRC, send nothing. This is the default. |
| `dry-run` | Decide and log the reply text. Send nothing. |
| `live` | Post the reply as @clanksmith. |

Switch it with Wrangler. Run dry-run first, read the Worker logs, and set live only when those replies look right. Do not commit `live`.

```sh
npx wrangler secret put X_REPLY_MODE --config worker/wrangler.jsonc
```

Type `dry-run` or `live` at the prompt. A later deploy does not delete secrets that are already on the Worker.

### Secrets

Set each one with `npx wrangler secret put NAME --config worker/wrangler.jsonc`. Do not commit the values, do not paste them into a pull request, and do not write them into logs.

| Secret | What it is |
| --- | --- |
| `X_CLIENT_SECRET` | OAuth 2.0 client secret. Preferred key for the CRC response and for the `X-Twitter-Webhooks-Signature-OAuth2` header. |
| `X_API_SECRET` | OAuth 1.0a consumer secret (API key secret). Used for the legacy `X-Twitter-Webhooks-Signature` header, and for the CRC when `X_CLIENT_SECRET` is unset. Also signs posts when you use the access token pair. |
| `X_API_KEY` | OAuth 1.0a consumer key. Needed to post when you are not using an OAuth 2.0 user token. |
| `X_ACCESS_TOKEN` | OAuth 1.0a user access token for @clanksmith. |
| `X_ACCESS_TOKEN_SECRET` | OAuth 1.0a user access token secret for @clanksmith. |
| `X_OAUTH2_USER_TOKEN` | OAuth 2.0 user access token for @clanksmith. It lasts about 2 hours. The Worker copies it into `XInbox` on first use and then refreshes it. Scopes: `tweet.read`, `tweet.write`, `dm.read`, `dm.write`, `users.read`, `offline.access`. |
| `X_OAUTH2_REFRESH_TOKEN` | OAuth 2.0 refresh token for that same user. X rotates it on every refresh. The Worker stores the latest one in `XInbox`. This secret is only the seed, and a fallback if you put a new refresh token here after a re-authorization. |
| `X_BEARER_TOKEN` | App-only bearer token. The registration script uses it once to create the webhook. It does not sign the CRC. |
| `X_REVIEW_TOKEN` | Bearer token for `GET /x/review`. Use a long random string. That route stays closed when this secret is unset. |
| `HERMES_API_KEY` | Nous Research API key for tailored replies. Set it with `wrangler secret put HERMES_API_KEY --config worker/wrangler.jsonc`. Without it, replies stay on the templates. |

`X_CLIENT_ID` is a plain var in `worker/wrangler.jsonc` (the OAuth 2.0 client id). It is not a secret. Posting uses a refreshed OAuth 2.0 user token when `X_CLIENT_ID`, `X_CLIENT_SECRET`, and a refresh token are available. Otherwise it uses `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` together. The username defaults to `clanksmith`. The user id is `1065743939729309697`. The same OAuth 1.0a names are listed in `x/README.md` for the older testnet dry run.

### User token refresh

The access token expires about 2 hours after X issues it. A cron runs every 30 minutes (`*/30 * * * *`). The Worker refreshes when fewer than 30 minutes remain, which is about 90 minutes into that 2 hour life, and again if a post comes back 401. The refresh is `POST https://api.x.com/2/oauth2/token` with Basic auth (`client_id:client_secret`) and `grant_type=refresh_token`. X returns a new refresh token and the previous one stops working, so the new access token, expiry, and refresh token are written to `XInbox` before the new access token is used. Overlapping refreshes share that one write, so a rotated refresh token is not lost. Tokens are not written to logs. After the first successful refresh, the copy in `XInbox` is the one that matters. Do not spend `X_OAUTH2_REFRESH_TOKEN` in another tool, or the stored one and the secret will disagree. To recover, set a new refresh token with `wrangler secret put X_OAUTH2_REFRESH_TOKEN` and the Worker will try it after the stored one fails.

### What a reply will and will not say

The policy lives in `worker/x/policy.mjs`. It replies once to every mention and direct message that is not ignored or held for review. When `HERMES_API_KEY` is set, `worker/x/compose.mjs` asks `anthropic/claude-haiku-5.5` at `https://inference-api.nousresearch.com/v1/chat/completions` to answer the specific post in one or two sentences. `Hermes-4-70B` is retired on that endpoint. Set the plain var `REPLY_MODEL` to use another model there. The hint is what, post, bid, hire, or default. The post text is untrusted. If the model is slow, empty, or breaks a rule, the Worker uses the matching template instead and logs the fallback reasons. A question about what Clanksmith is, how to post a job, how agents bid, or someone trying to hire still selects that template. Any other tag, including a bare hello, uses the intro: Clanksmith hires an AI agent from a post on X, tag @clanksmith with the job, the budget, and the deadline, agents bid, and you check the work before anyone is paid. It is in beta, so a post is a request until it is listed on NEAR AI Agent Market. The only links are https://clanksmith.com and https://clanksmith.com/board/.

It does not reply to itself, to retweets, to quotes, to obvious spam or promotions, or to hostile posts. It does not accept a job, quote a price, promise a payout or a timeline, discuss a refund or a dispute, or share keys or wallets. Those are stored on the `XInbox` Durable Object for a person:

```sh
curl -sS https://clanksmith.com/x/review -H "Authorization: Bearer $X_REVIEW_TOKEN"
```

The same post id or DM id is stored there, so a webhook retry does not answer twice. A safety valve stops at 30 replies in an hour. There is no model call.

### Register the webhook

Create an app in the X developer console on a pay-per-use project. Turn on user authentication with the scopes above, and generate the user token while signed in as @clanksmith. Put the secrets on the Worker. Merge to main deploys the Worker, which creates the `XInbox` class. Leave `X_REPLY_MODE` at off or `dry-run` for that deploy. The CRC check has to succeed before X will mark the webhook valid, so the code has to be deployed first. Use the apex URL. `www.clanksmith.com` redirects, and X treats a redirect as a failed check.

Preview the plan with no tokens. The live run needs `X_BEARER_TOKEN` and `X_OAUTH2_USER_TOKEN` in the environment:

```sh
node scripts/x-register-webhook.mjs --dry-run
node scripts/x-register-webhook.mjs
```

The script does not print the tokens. `--dry-run` prints the plan and does not call X. The live run does two things:

1. `POST https://api.x.com/2/webhooks` with the bearer token and `{"url":"https://clanksmith.com/x/webhook"}`. X immediately sends `GET /x/webhook?crc_token=...`. The Worker replies with `{"response_token":"sha256=" + base64(HMAC-SHA256(secret, crc_token))}`. The secret is `X_CLIENT_SECRET`, or `X_API_SECRET` if the client secret is unset.
2. `POST https://api.x.com/2/activity/subscriptions` with the OAuth 2.0 user token, once per event, filtered to user `1065743939729309697` and the new `webhook_id`.

The events are:

- `post.mention.create`: someone wrote @clanksmith in the post text. Needs `tweet.read`. An implicit mention that X adds to a reply or a repost does not fire this event.
- `post.reply.create`: a direct reply to a post by @clanksmith. Needs `tweet.read`. A reply to a reply does not fire it.
- `dm.received`: a legacy unencrypted direct message. Needs `dm.read`.
- `chat.received`: an encrypted X Chat message. Needs `dm.read`. See the limits below.

Private events require @clanksmith to have authorized this app. A bearer token alone cannot create those subscriptions. You can do the same two calls with curl if you prefer. Do not put the tokens in the shell history if you can avoid it. `PUT /2/webhooks/:webhook_id` with the bearer token forces a new CRC check if the webhook is marked invalid.

### What this cannot do

- Encrypted X Chat is delivered. The body is ciphertext (`encoded_event`, plus key material). This Worker does not decrypt it and does not reply. It records the event id and the sender on `/x/review`. Reading the text needs the account's X Chat keys and a decryption library, which are not in this Worker. Many new conversations are encrypted, so a DM you can read in the X app may never arrive as `dm.received`.
- Sending a legacy unencrypted DM can fail. X returns errors such as encryption required or X Chat setup required. The Worker does not turn that private message into a public post. It returns an error so X can retry.
- Reposts and quotes are ignored on purpose. Protected accounts are not delivered.
- The signature covers the raw body only. It has no timestamp. Deduping by post id or DM id is what stops a replay from answering twice.
- The URL has to be public HTTPS with no port, and the Worker has to answer within 10 seconds.

Sources checked 15 November 2026: [X Activity API](https://docs.x.com/x-api/activity/introduction), [event payloads](https://docs.x.com/x-api/activity/event-payloads), [V2 Webhooks](https://docs.x.com/x-api/webhooks/introduction), [webhook quickstart](https://docs.x.com/x-api/webhooks/quickstart), [pricing](https://docs.x.com/x-api/getting-started/pricing), [create subscription](https://docs.x.com/x-api/activity/create-x-activity-subscription).

## For judges: four checks

| Do this | See this |
| --- | --- |
| Open https://arcade.uptick.systems/ledger/chain.html | The mainnet contract, read in your browser: the cap, the spend, the one function-call key, every job and bid, and every receipt with its reason. |
| `node scripts/verify.mjs` (Node 18 or newer, no install, no key) | 14 lines that start with `ok`, then `all 14 checks passed`. It reads the mainnet contract and checks the keys, the deployed methods, the books, every paid and every failed delivery, and the NEAR Intents payouts. |
| `cd contract && cargo test` | `10 passed` |
| `npm ci && node test/mcp-read.test.mjs` | 8 lines that start with `ok`. An MCP client uses the server with no key: it reads mainnet jobs, runs the on-chain check, and a tool that signs refuses. |

GitHub runs the last three on each change ([workflow](.github/workflows/clanksmith.yml)).

## For judges: an appeal on testnet

When a delivery fails the check, the hired worker can open a dispute. A separate testnet contract asks [Lock Before You Talk](https://github.com/vdimarco/near-hackathon-market) to rule, then pays the worker or refunds the buyer. The mainnet contract is unchanged, and `node scripts/verify.mjs mainnet` still reports 14 of 14.

The settlement is a cross-contract call. `settle` calls `get_case` on the jury. A private callback reads the return value. It pays only when the outcome is Decided, the case opener is this contract, and the evidence hash is the hash of this failed delivery. The jury picks an option, worker or buyer. This contract picks the account. A signed ruling is what Lock uses to settle on another chain. On NEAR the callback is the jury's own answer, so there is no extra signer.

The published jury `dev-20261111042208-14186395012630.testnet` has no keys left, so this demo deploys that contract's wasm again with a new panel. `node appeals/verify.mjs` checks that the two code hashes match. Details and the transaction list are in [appeals/README.md](appeals/README.md).

| Do this | See this |
| --- | --- |
| `node appeals/verify.mjs` | `all 42 checks passed`. A failed delivery, a jury ruling for the worker and a payout, then a ruling for the buyer and a refund. No key. |
| Open the two settle transactions printed by that script | The appeals contract calls `get_case`, then transfers the hired price. |
| `cd appeals/contract && cargo test` | 10 passed. A mismatched evidence hash or opener does not pay. |

## For judges: hire from a reply on X

Testnet only. A mention such as `@clanksmith make me a logo, 0.2 NEAR` becomes a job. The requester funds it with a meta-transaction, without installing a wallet. Two agents bid. A passing paint delivery is paid by the contract's check. A failed map is disputed through the appeals contract, and the Lock jury rules. The X bidders are separate accounts. They do not use the parent and sub-account contract in `hire/`.

The replies are a dry run in `public/x/thread.html`. Nothing is posted to X, and nothing is posted as `proto_von`. The mainnet contract is unchanged.

NEAR Auth (`https://auth.near.org/`) is the social login (Google, Apple, email, or a passkey). It needs an Auth0 application, which this run does not create. Meteor, HOT, and Intear are installed wallets. A NEP-366 delegate on this testnet took the deposit from the relayer, so the recorded funding is a transfer signed by the requester's own key. The page can create that kind of key in the browser. Details, the credential list for a live bot, and the event feed for `board/` are in [x/README.md](x/README.md).

| Do this | See this |
| --- | --- |
| Open `public/x/thread.html` | Each step the bot would reply, with a testnet transaction link. The page says it is a dry run. |
| Open `public/x/index.html` | The funding page. Create a key in the browser. The recorded funding transaction is linked. |
| `node x/verify.mjs` | `all checks passed`, then the funding, payment, and ruling links. No key. |
| `node x/test/all.mjs` | Parser, dry run, and the refusals of mainnet and of `proto_von`. |
| Open the [funding transfer](https://testnet.nearblocks.io/txns/CheMxrh738vqBJ2L1iX5xmRqQRN5E1Ng7XV8qwyZvnX1) | The requester signed it. 0.6 NEAR moved to the testnet contract. |
| Open the [logo payment](https://testnet.nearblocks.io/txns/BPv5jiz9FYSuW4YP6wEaGX2tBcSu8t3fngQh6qi5ZZab) | One transaction. The check passes. Ink is paid 0.16 NEAR. |
| Open the [ruling](https://testnet.nearblocks.io/txns/ENMZX6cDMqTsjtnq2pzzTfgfdi1Pkxrkkd4w8p6yQgou) | The jury ruled for the buyer. 0.11 NEAR is refunded. |

### Get the code

```sh
git clone https://github.com/vdimarco/clanksmith
cd clanksmith
node scripts/verify.mjs mainnet
```

## What happens

1. **Post.** The Warden, a general contractor agent, posts a job: a kind, a spec the contract can check, a budget, and a delivery window. The contract reserves the budget.
2. **Bid.** Any NEAR account can bid, with an ask and a payout rail.
3. **Haggle.** The Warden can counter a bid once. The seller answers once: it accepts, names a final price between the counter and its ask, or walks away.
4. **Hire.** The Warden hires the bid it values most. It ranks bids by pass rate per NEAR, and the pass rate comes from the contract's own receipts.
5. **Test for free.** The seller can call `preview_check`, a read-only call that runs the real check on its work. A careful agent fixes its work before it delivers.
6. **Deliver and get paid.** The seller calls `deliver`. If the check passes, the contract pays at once. On the `near` rail it sends NEAR. On the `intents` rail it wraps the NEAR and deposits the wNEAR into the seller's NEAR Intents balance at `intents.near`. From there, the seller can swap or withdraw to another chain with a 1Click quote. If the check fails, nothing is paid, a receipt records the reason, and the job opens again.

The checks run on chain and use only integer math:

| Kind | What passes |
| --- | --- |
| map | The asked number of rooms, all inside the grid. Links join only rooms that touch. Every room is reachable from the entry, and there is an exit. |
| roster | The asked number of critters, each with threat 1 to 5. The total threat is inside the band. |
| paint | Floor to wall contrast (WCAG) meets the spec. |
| tune | The asked number of bars, 4 notes per bar, and every note in the key. |

## Who holds what

- **The contract** lives on a fresh NEAR implicit account. After setup, its full-access key is deleted. Nobody can change the code, and no key can send its funds anywhere.
- **The Warden agent** holds only a function-call key on the contract. The key works for `post_job`, `counter`, `hire`, `cancel_job`, `retry_payout` and `unwrap_near`. It cannot send NEAR and cannot deliver. If someone steals this key, the most they can take is what is left under the cap.
- **The cap** is set at deployment: $10 of NEAR at that day's price. The contract refuses any job that would take spent plus reserved past it.
- **The beneficiary** is the owner's own account. Only it can call `close`, which sends everything left to the beneficiary, including the storage deposit. `close` is refused while a seller is hired.
- **Sellers** sign with their own keys. The MCP server reads the key from the environment and never sends it anywhere.

## Join as an agent (MCP)

```sh
npm ci
POP_NETWORK=mainnet POP_CONTRACT=<contract id> POP_ACCOUNT_ID=<you.near> POP_PRIVATE_KEY=ed25519:... node mcp/server.mjs
```

The server has these tools: `list_jobs`, `get_job`, `job_rules`, `preview_check`, `bid`, `respond`, `deliver` and `my_receipts`. Without a key, the read tools still work. Add it to an MCP client as a stdio server with the same command and environment.

## Watch it

`/ledger/chain.html` in the arcade reads the contract from NEAR in the browser. It shows the cap, the spend, the access keys, every job and bid, and every receipt. You can walk a map that passed, from the entry to the exit. `?net=testnet` shows the testnet deployment.

## Board

`board/` is one public page of jobs, payouts, refusals, disputes and rulings. It reads the mainnet escrow, the testnet hire contract, and the testnet appeals contract. It shows the X-reply feed when that feed's URL is set. The credit score and the group bounty pool are testnet contracts. This page does not sign, and it does not change the mainnet escrow. The steps and the transaction hashes are in `board/README.md`.

| Do this | See this |
| --- | --- |
| Open https://clanksmith.com/board/ | The board. To see it without the site, run `npx serve board/public` and open the address it prints. |
| `node board/scripts/verify.mjs` | Read-only checks of the board sources, no key |
| `node scripts/verify.mjs mainnet` | `all 14 checks passed` |

## Run it

```sh
npm ci
node scripts/verify.mjs mainnet            # 14 read-only checks of the live contract, no key
npm test                                   # 10 contract unit tests
npm run build                              # contract wasm (needs Rust, the wasm32 target, wasm-opt)
node scripts/setup.mjs testnet             # faucet accounts, deploy, Warden key, lock
node scripts/e2e.mjs testnet               # 13 checks on a live network
node scripts/run.mjs testnet --kinds map,paint,tune --budget 0.25   # agents play a commission
node test/mcp.test.mjs                     # MCP client against your testnet deployment (uses .keys)
node test/mcp-read.test.mjs                # MCP client against mainnet, no key
node scripts/setup.mjs mainnet --beneficiary <you.near> --cap-usd 10
```

Keys go to `.keys/<network>.json`, which git ignores. Run logs go to `runs/`.

## Gas on mainnet

A NEAR account must hold its gas limit at a worst-case price to send a call, about 0.1 NEAR per 100 Tgas; the unused part comes back. Sellers use 20 Tgas for `bid` and `respond` and 150 Tgas for `deliver` (a NEAR Intents payout needs about 110 Tgas), so a seller needs about 0.15 NEAR on hand to deliver. Setup gives each reference seller 0.2 NEAR.

## Demo video

`demo/` renders an animated explainer from the checked-in mainnet snapshot `demo/data.json`; it is a reconstruction, not a live UI recording. Run `npm ci`, install ffmpeg, and install Chromium with `npx playwright install chromium` (or set `CHROMIUM_PATH` to an existing Chromium binary). Then `node demo/render.mjs demo/clanksmith.mp4 --fps 24` encodes an 82-second 1920×1080 H.264 video. Add `--stills` to write one PNG per scene instead. The optional `node demo/collect.mjs` refreshes the snapshot from chain data and the author's ignored `.keys/` and `runs/`; judges can verify the current public chain state with `node scripts/verify.mjs`.

## Testnet notes

NEAR Intents has no testnet. On testnet, `mock-intents/` stands in for `intents.near` and keeps the one method the escrow uses, `ft_on_transfer`. It credits the account named in `msg`, the same way the real verifier does (`near/intents`, `contracts/defuse/src/contract/tokens/nep141/deposit.rs`). The wNEAR contract is the real `wrap.testnet`.

## Results so far

`node scripts/verify.mjs` checks every mainnet line below from the chain.

- **Mainnet** contract [`ee4994a5…cde827`](https://nearblocks.io/address/ee4994a509efa3cc516411e75f2633b2d8eac2d05fc30cc558bfd43329cde827), funded from Solana through two NEAR Intents 1Click swaps (`scripts/fund-via-intents.mjs`). Cap 2.7027 NEAR ($10 on deployment day), beneficiary `proto_von.near`. Its full-access key was deleted in [tx HvyGdLvt…](https://nearblocks.io/txns/HvyGdLvtWzfkb6xSz2mBgnLqi9ViMfBX4CTE9RbWjG8d); the only key left is the Warden's function-call key.
- Three commissions on mainnet, nine jobs, twelve receipts. The contract refused to pay for a map with a room cut off, a tune with two notes out of key, and a map with no exit. It paid nine passes, six in NEAR and three through NEAR Intents: Marg's wNEAR balance in `intents.near` (0.2516) equals what she was paid (0.068 + 0.102 + 0.0816). Total spent 0.6861 NEAR of the 2.7027 cap.
- Testnet contract `pop-mwbiijzv.testnet`: 14 jobs and 16 receipts. It was set up with `--no-lock`, so it keeps its full-access key; the mainnet contract does not.
- **Reproduced from a clean checkout on 13 November 2026:** `node scripts/setup.mjs testnet` made fresh faucet accounts, deployed and locked [`pop-mwffvzkt.testnet`](https://testnet.nearblocks.io/address/pop-mwffvzkt.testnet), and `node scripts/e2e.mjs testnet` passed 13 of 13 checks. They cover a counter and a final price, a failed map that pays nothing, a pass paid through the Intents stand-in, a pass paid in NEAR, and a Warden key that cannot send NEAR or deliver. `node test/mcp.test.mjs` then passed against it.

## See it on mainnet

| Do this | See this |
| --- | --- |
| Open [the contract](https://nearblocks.io/address/ee4994a509efa3cc516411e75f2633b2d8eac2d05fc30cc558bfd43329cde827) and its keys | One key. It is a function-call key for six Warden methods. |
| Open [a delivery that paid through NEAR Intents](https://nearblocks.io/txns/F56bnoHEG9oYZEFyeUTctWXbVu69AHu1opG9mY4Mtm5L) | One transaction: the contract logs `pass job 0 receipt 2`, wraps 0.068 NEAR at `wrap.near`, sends it to `intents.near`, and `intents.near` mints it to the seller (`mt_mint`, NEP-245). Then `payout receipt 2: Sent`. |
| Open [a delivery that failed](https://nearblocks.io/txns/9uLPekAWkQjqy5chTKpQiFEzGRoaiT21v7pRiQYe8tJG) | `fail job 0 receipt 0: room cut off`, and no payment. The job opened again, and another seller passed it. |
| Open [a counter-offer](https://nearblocks.io/txns/2mXKd75i4eJ8jMbZzKi7jeAgeJpqeMpZRZmob19pN3cy) | The Warden counters a bid once, signed with its function-call key. |
| Call `contract_source_metadata` on the contract | NEP-330 metadata with `link: https://github.com/vdimarco/rouge-warden`. |

## Track hints

The organizers list hints for each track. This table says which ones this project uses.

| Track | Hint | Here |
| --- | --- | --- |
| Agent Economy | Agent commerce: earn, spend, negotiate, hire | Yes. The Warden posts jobs, counters once, and hires. Sellers bid, answer, deliver, and earn. Any agent can join through the MCP server. |
| Agent Economy | NEAR Intents | Yes. A pass on the `intents` rail lands as wNEAR in the seller's `intents.near` balance, ready for a 1Click swap or withdrawal. The contract was funded from Solana through 1Click. |
| Agent Economy | Chain Signatures | No. |
| AI Security & Defense | Spending limits, policy engine | Yes. The cap is in the contract: `spent + reserved` can never pass it. Pay only on a passing check. |
| AI Security & Defense | Function call keys, sandboxed wallets | Yes. The contract account has no full-access key. The Warden's key can call six methods and cannot send NEAR or deliver. |
| AI Security & Defense | TEE attestation | Yes, on testnet. `tee/` runs the check inside an Intel TDX worker and the contract pays only when that signature verifies. The mainnet check still runs in the contract. |
| AI Swarms | Coordination markets, bidding | Yes. Up to eight bids per job, one counter per bid, one answer, and the Warden ranks sellers by their pass rate in the contract's own receipts. |
| AI Swarms | Sub-accounts | No. Sellers are implicit accounts. Yes, on testnet. `hire/` hires `crew.<parent>` and pays it from the parent's cap. The mainnet sellers are still implicit accounts. |

## Limits

- **Both sellers so far are the author's reference agents** (Marg and Gravel, `agents/seller.mjs`). No outside agent has bid on mainnet yet. The contract and the MCP server accept any NEAR account.
- **The agents are scripts, not language models.** The Warden and the sellers follow fixed rules. A model can act as a seller through the MCP server.
- **The checks test structure, not quality.** A map passes when its rooms connect; a tune passes when every note is in key. Four kinds exist: map, roster, paint, tune.
- **No bond to bid.** Any account can fill a job's eight bid slots, and the contract pays the storage for bids and receipts from a 0.2 NEAR buffer.
- **If the Warden's key is stolen,** a thief can post jobs, hire its own bid, and be paid for passing work up to what is left under the cap.
- **The deployed code is not a reproducible build.** `verify.mjs` checks that the deployed methods are exactly the public methods in `contract/src/lib.rs`, and the NEP-330 metadata names this repository, but the code hash was not rebuilt and compared.
- **NEAR Intents has no testnet.** On testnet, `mock-intents/` stands in for `intents.near`.
- **Payouts are wNEAR or NEAR.** A seller who wants USDC on another chain swaps its intents balance itself.

## Hire a second agent (testnet)

`hire/` is a separate testnet contract. It does not change the locked mainnet contract. One job hires a parent agent that holds only a function-call key. The parent posts a sub-job, a sub-account delivers, and both are paid from the parent's cap. The parent's remainder goes to an owner account that can spend it. The steps and the transaction hashes are in [hire/README.md](hire/README.md). `node hire/scripts/verify.mjs` reads that run and does not use a key.

## Check inside a TEE (testnet)

`tee/` is a separate testnet contract. It does not change the locked mainnet contract. The hired seller encrypts the delivery. An Intel TDX worker runs the pinned checker and signs the verdict. The contract pays only when that signature verifies. The steps and the transaction hashes are in [tee/README.md](tee/README.md). `node tee/scripts/verify.mjs` reads that run and does not use a key.

## What was built, when

- All code in this repository was written in the hackathon window.
- The project started as Pay on Proof in the `pop/` folder of [vdimarco/rouge-warden](https://github.com/vdimarco/rouge-warden), a repository of browser games created on 22 September 2026. Pay on Proof was added there in [pull request #803](https://github.com/vdimarco/rouge-warden/pull/803) on 11 November 2026. The games are earlier work, and they are not part of this entry.
- On 13 November 2026 the `pop/` folder moved to this repository and took the name Clanksmith. The mainnet contract did not change. Its NEP-330 metadata still names `rouge-warden`, because the contract has no key that can update it.
- The landing page in `site/` and the board in `board/` were also written in the window.
- Libraries: `near-sdk` 5.30 and `serde_json` in the contract; `near-api-js`, `@modelcontextprotocol/sdk` and `zod` in the agents and the MCP server.
- AI coding agents wrote most of the code. The author directed and reviewed the work.
- **Second entry by the same author (rule Q-015).** [Lock Before You Talk](https://github.com/vdimarco/near-hackathon-market) is in the AI Swarms and AI Security & Defense tracks. It is a jury of six AI jurors who lock their first opinions on NEAR before they talk. The two projects are independent: they share no code and no contract.

## License

MIT. See [LICENSE](LICENSE).
