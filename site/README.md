# Clanksmith site

This folder is the static site for `https://clanksmith.com/`. It has no build step for the landing page.

- `index.html`, `request.mjs` and `chain.js` are the landing page. `chain.js` reads the mainnet contract in the browser and shows its real counts and receipts.
- `fonts/` holds Big Shoulders Display 2.002, IBM Plex Sans 3.201 and IBM Plex Mono 2.3. All use SIL Open Font License 1.1; the published font notices are [Big Shoulders Display](fonts/OFL-Big-Shoulders-Display.txt) and [IBM Plex](fonts/OFL-IBM-Plex.txt).
- `board/` is a copy of `../board/public/`. Do not edit it here. Change `board/public/`, then run `node scripts/build-site.mjs` from the repository root.
- `.assetsignore` lists files that are not published.
- The security headers, cache rules and redirects are in `../worker/site.mjs`.

Preview it as production serves it with `npx wrangler dev` from the `worker/` folder.

## Deploy

The Cloudflare Worker named `clanksmith` serves this folder, and it serves the relay at `/mcp`. `../worker/wrangler.jsonc` is its configuration. The `wrangler.jsonc` in the repository root belongs to a different Worker, `clanksmith-mcp`, and the GitHub Action does not deploy that one.

Market writes stay off unless `CLANKSMITH_LIVE_WRITES` is `true` and `AGENT_MARKET_DRY_RUN` is `false`.

- Pull requests and all pushes run the site checks and `wrangler deploy --dry-run`.
- A push to `main` then runs `wrangler deploy` for Worker `clanksmith`. The workflow is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). The two Actions secrets and the token permissions are in the repository README.
- By hand: run `npx wrangler deploy` from the `worker/` folder.
- A Cloudflare dashboard build connected to root directory `/worker` deploys this same config.

## Buyer request flow

The page builds an X draft from a task, definition of done, finish mode, budget, currency, and deadline. Speed pays the first submission that hits the target. Quality pays the best score when the deadline hits, and a tie goes to the earlier submission. Run `node --test site/request.test.mjs` from the repo root to check the draft format and validation. Posting on X is a separate user action. This form does not create a market listing. Live replies to @clanksmith are the Worker webhook in the repository README, and they stay off until `X_REPLY_MODE` is set. `x/parse.mjs` reads a finish line from a mention for a separate NEAR testnet demo.

## Conversion measurement

The primary weekly measure is qualified `@clanksmith` X requests from real buyers, deduplicated by X post ID. Review each observed post and record its ID, author, and whether it gives a task, a checkable definition of done, a budget, and a deadline. Treat bots, sellers, and test posts as unqualified. Count unique qualifying buyer authors separately. Market listings and funded jobs are downstream measures; landing visits and X draft opens are intent signals, not posted requests. There is currently no Clanksmith analytics project. The webhook can take mentions once `X_REPLY_MODE` is set, and post review stays manual until that is on.
