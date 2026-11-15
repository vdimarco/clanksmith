// CRC and webhook signatures for the X V2 Webhooks API.
// HMAC-SHA256, base64, prefixed with sha256=. The key is the OAuth 2.0 client
// secret or the OAuth 1.0a consumer secret. Never the bearer token.

const encoder = new TextEncoder();

function asBytes(message) {
  if (typeof message === "string") return encoder.encode(message);
  if (message instanceof Uint8Array) return message;
  return new Uint8Array(message);
}

function base64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, asBytes(message));
  return base64(new Uint8Array(signed));
}

export async function crcResponseToken(crcToken, secret) {
  return "sha256=" + await hmacSha256(crcToken, secret);
}

// Hash both strings first so a length mismatch does not skip the compare.
export async function sameSecret(a, b) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(a ?? ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(b ?? ""))),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function matches(raw, header, secret) {
  if (!header || !secret) return false;
  const expected = "sha256=" + await hmacSha256(raw, secret);
  return sameSecret(header.trim(), expected);
}

export async function verifyWebhookSignature({ raw, header, secret, headers, clientSecret, consumerSecret }) {
  if (headers) {
    const oauth2 = headers.get("x-twitter-webhooks-signature-oauth2");
    const legacy = headers.get("x-twitter-webhooks-signature");
    if (oauth2 && clientSecret && await matches(raw, oauth2, clientSecret)) return true;
    if (legacy && consumerSecret && await matches(raw, legacy, consumerSecret)) return true;
    return false;
  }
  return matches(raw, header, secret);
}
