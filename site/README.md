# Clanksmith site

This folder is the static site for `https://clanksmith.com/`. It has no build step for the landing page.

- `index.html`, `motion.js` and `chain.js` are the landing page. `chain.js` reads the mainnet contract in the browser and shows its real counts.
- `board/` is a copy of `../board/public/`. Do not edit it here. Change `board/public/`, then run `node scripts/build-site.mjs` from the repository root.
- `_headers` holds the security headers and cache rules for Cloudflare.

Preview it from this folder with `python3 -m http.server 8000`.

To publish, upload this whole folder to the Cloudflare project that serves the domain. The deploy route is not in this repository.
