import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { crcResponseToken, verifyWebhookSignature } from "./sign.mjs";

const SECRET = "consumer-secret-value";
const CLIENT = "oauth2-client-secret-value";

function nodeToken(message, secret) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(message).digest("base64");
}

test("CRC response is sha256= plus base64 HMAC-SHA256 of the crc token", async () => {
  const token = "crc-token-from-x";
  assert.equal(await crcResponseToken(token, SECRET), nodeToken(token, SECRET));
});

test("a matching raw-body signature is accepted and a flipped body is rejected", async () => {
  const raw = new TextEncoder().encode('{"event":"post.mention.create","n":1}');
  const header = nodeToken(raw, SECRET);
  assert.equal(await verifyWebhookSignature({
    raw,
    header,
    secret: SECRET,
  }), true);

  const flipped = new Uint8Array(raw);
  flipped[flipped.length - 1] ^= 1;
  assert.equal(await verifyWebhookSignature({
    raw: flipped,
    header,
    secret: SECRET,
  }), false);
});

test("a missing, empty, or wrong-length signature is rejected", async () => {
  const raw = new TextEncoder().encode("{}");
  assert.equal(await verifyWebhookSignature({ raw, header: "", secret: SECRET }), false);
  assert.equal(await verifyWebhookSignature({ raw, header: null, secret: SECRET }), false);
  assert.equal(await verifyWebhookSignature({ raw, header: "sha256=abc", secret: SECRET }), false);
  assert.equal(await verifyWebhookSignature({ raw, header: nodeToken(raw, SECRET), secret: "" }), false);
});

test("the oauth2 header is checked with the client secret and the legacy header with the consumer secret", async () => {
  const raw = new TextEncoder().encode('{"id":"1"}');
  const headers = new Headers({
    "x-twitter-webhooks-signature-oauth2": nodeToken(raw, CLIENT),
    "x-twitter-webhooks-signature": nodeToken(raw, "not-the-consumer-secret"),
  });
  assert.equal(await verifyWebhookSignature({
    raw,
    headers,
    clientSecret: CLIENT,
    consumerSecret: SECRET,
  }), true);

  const legacyOnly = new Headers({
    "x-twitter-webhooks-signature": nodeToken(raw, SECRET),
  });
  assert.equal(await verifyWebhookSignature({
    raw,
    headers: legacyOnly,
    clientSecret: "",
    consumerSecret: SECRET,
  }), true);

  const neither = new Headers();
  assert.equal(await verifyWebhookSignature({
    raw,
    headers: neither,
    clientSecret: CLIENT,
    consumerSecret: SECRET,
  }), false);
});
