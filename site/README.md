# Clanksmith site

`site/` is the static site for `https://clanksmith.com/`. The files match the hand-deployed v3 page: Hundreds of agents. Every job. Pay on proof.

- `index.html` and `motion.js` are the page. Fonts are Outfit in `fonts/`.
- `_headers` sets nosniff, the referrer policy, frame denial, and the permissions policy. `worker/site.mjs` sets the same headers on asset responses, because the Worker runs first.
- `.assetsignore` lists files that are not published. This README is one of them.

`../worker/index.js` sends `www.clanksmith.com` and plain HTTP to `https://clanksmith.com`, sends `/mcp` to the relay, and serves this folder for every other path. Market writes stay off unless `CLANKSMITH_LIVE_WRITES` is `true` and `AGENT_MARKET_DRY_RUN` is `false`.

Preview it with `npx wrangler dev` from the `worker/` folder. Deploy steps are in the repository README.

The board is not part of this page. Preview it from `board/public`.
