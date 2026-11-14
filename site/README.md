# Clanksmith site

`public/` is the static site for `https://clanksmith.com/`. Those files are the live page. `src/worker.js` sends `www.clanksmith.com` to the apex, sends `/mcp` to the relay, and serves every other path from `public/` with Workers Static Assets. Config is `wrangler.jsonc` in this folder. Deploy steps and the API token permissions are in the repository README.

`assets-src/mascot.png` is source art. It is not served.

`board/` is a copy of `../board/public/`. Do not edit it here. Change `board/public/`, then run `node scripts/build-site.mjs` from the repository root. `board/` is outside `public/`, so this deploy leaves `https://clanksmith.com/board/` as the live 404 page.

`request.mjs` builds a buyer X draft. `chain.js` reads the mainnet contract. The live page does not load either file. Run `node --test site/request.test.mjs site/src/route.test.mjs` from the repository root.

Preview the static files from `public/` with `python3 -m http.server 8000`.
