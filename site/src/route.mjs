// Host and path decisions for the clanksmith Worker.
// www goes to the apex. /mcp is the relay. Every other path is a static asset.

export function apexRedirect(url) {
  if (url.hostname !== "www.clanksmith.com") return null;
  const next = new URL(url);
  next.hostname = "clanksmith.com";
  return next;
}

export function isRelayPath(pathname) {
  return pathname === "/mcp" || pathname === "/mcp/";
}
