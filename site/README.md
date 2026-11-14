# Clanksmith site

This folder is the static site for `https://clanksmith.com/`. It has no build step for the landing page.

- `index.html`, `motion.js`, `request.mjs` and `chain.js` are the landing page. `chain.js` reads the mainnet contract in the browser and shows its real counts.
- `board/` is a copy of `../board/public/`. Do not edit it here. Change `board/public/`, then run `node scripts/build-site.mjs` from the repository root.
- `.assetsignore` lists files that are not published.
- The security headers, cache rules and redirects are in `../worker/index.js`.

Preview it as production serves it with `npx wrangler dev` from the `worker/` folder.

## Deploy

The Cloudflare Worker named `clanksmith` serves this folder, and it serves the relay at `/mcp`. `../worker/wrangler.jsonc` is its configuration. The `wrangler.jsonc` in the repository root belongs to a different Worker, `clanksmith-mcp`, and the GitHub Action does not deploy that one.

Market writes stay off unless `CLANKSMITH_LIVE_WRITES` is `true` and `AGENT_MARKET_DRY_RUN` is `false`.

- Pull requests, and pushes to branches other than `main`, run `wrangler deploy --dry-run`.
- A push to `main` runs `wrangler deploy` for Worker `clanksmith`. The workflow is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). The two Actions secrets and the token permissions are in the repository README.
- By hand: run `npx wrangler deploy` from the `worker/` folder.
- A Cloudflare dashboard build connected to root directory `/worker` deploys this same config.

## Buyer request flow

The page builds an X draft from a task, definition of done, budget, currency, and deadline. Run `node --test site/request.test.mjs` from the repo root to check the draft format and validation. Posting on X is a separate user action. This repo does not receive live X mentions or create a market listing from this form; `x/parse.mjs` is a separate NEAR testnet demo.

## Conversion measurement after production is connected

Track unique buyer landing visits, X draft opens, observed `@clanksmith` mentions, valid requests from real buyers, market listings, and funded jobs. Deduplicate posts by X post ID and jobs by market job ID. The primary weekly measure is unique real buyers with a valid funded job. An X draft open is only an intent signal, not evidence of a posted request. There is currently no Clanksmith analytics project or production intake to record the later stages.
