// The dry-run thread. This is the page a recording shows. Nothing here is posted to X.
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function linkify(text) {
  return esc(text).replace(
    /https:\/\/testnet\.nearblocks\.io\/txns\/[1-9A-HJ-NP-Za-km-z]+|index\.html\?job=\d+|logo\.svg/g,
    (u) => `<a href="${u}">${u}</a>`,
  );
}

export function renderThread(posts, { bot = "clanksmith" } = {}) {
  const items = posts.map((p) => {
    const who = p.who === "you" ? "you" : bot;
    const img = p.image ? `<img class="swatch" alt="Delivered swatch" src="${esc(p.image)}">` : "";
    return `<article class="${p.who === "you" ? "you" : "bot"}"><b>${esc(who)}</b><p>${linkify(p.text)}</p>${img}</article>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clanksmith thread, dry run</title>
<meta name="theme-color" content="#141414">
<link rel="icon" href="brand/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="brand/favicon-32.png">
<link rel="apple-touch-icon" href="brand/apple-touch-icon.png">
<link rel="canonical" href="https://clanksmith.com">
<meta property="og:url" content="https://clanksmith.com">
<meta property="og:title" content="Clanksmith">
<meta property="og:image" content="brand/og.png">
<style>
  body { margin: 0; background: #141414; color: #f4efe4; font: 16px/1.45 system-ui, sans-serif; }
  header.brand { max-width: 28rem; margin: 0 auto; padding: 16px 16px 0; }
  .wordmark { display: block; height: 32px; width: auto; }
  main { max-width: 28rem; margin: 0 auto; padding: 12px 16px 16px; }
  h1 { font-size: 1.15rem; margin: 0 0 8px; }
  .note { color: #d9c89a; margin: 0 0 12px; }
  article { border-radius: 14px; padding: 12px; margin: 0 0 10px; }
  article b { display: block; font-size: 0.8rem; margin-bottom: 4px; }
  article p { margin: 0; overflow-wrap: anywhere; }
  .you { background: #2a2a2a; margin-left: 18%; }
  .bot { background: #1e1e1e; margin-right: 8%; }
  a { color: #FF6A1A; }
  img.swatch { display: block; width: 100%; max-width: 12rem; height: auto; margin-top: 8px; border-radius: 8px; }
  .tagline { margin: 8px 0 0; color: #d9c89a; font-size: 0.95rem; }
  .site-foot { max-width: 28rem; margin: 0 auto; padding: 0 16px 24px; color: #d9c89a; font-size: 0.8rem; }
</style>
</head>
<body>
<header class="brand"><img class="wordmark" src="brand/wordmark-light.png" alt="Clanksmith"><p class="tagline">Reply with an intent. Solvers compete. Pay on proof.</p></header>
<main>
<h1>Thread replay</h1>
<p class="note">Dry run. These are the replies the bot would post. Nothing was sent to X.</p>
${items}
</main>
<footer class="site-foot">User-owned AI.</footer>
</body>
</html>
`;
}
