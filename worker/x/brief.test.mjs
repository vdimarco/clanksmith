import assert from "node:assert/strict";
import test from "node:test";
import { draftReply, pointsAtReference, readBrief } from "./brief.mjs";

const BOUNTY = "Aktionariat's contract bounty pays 3 ETH for high-impact bugs (takeover or drain of a token, market or payment hub) and 1 ETH for medium. Email bugs@aktionariat.com with a Hardhat PoC against master. github.com/aktionariat/contracts";

const POINTER = {
  id: "2122006059141263643",
  authorId: "15320730",
  username: "proto_von",
  text: "@W3B_AI_SR @clanksmith check out the above",
  parentId: "2121989097954697556",
  parentText: BOUNTY,
  parentUsername: "W3B_AI_SR",
};

const OPENER = "This one is already spelled out.";
const FACTS = "Aktionariat pays 3 ETH for a high-impact bug and 1 ETH for a medium one. Email a Hardhat PoC against master to bugs@aktionariat.com.";

test("a pointer at a parent post is not treated as the job itself", () => {
  assert.equal(pointsAtReference("@W3B_AI_SR @clanksmith check out the above"), true);
  assert.equal(pointsAtReference("@clanksmith make a logo for 40 USD by Friday"), false);
});

test("the Aktionariat parent post supplies budget, deliverable, and submit path", () => {
  const brief = readBrief(POINTER);
  assert.equal(brief.via, "parent");
  assert.equal(brief.sourcePostId, "2121989097954697556");
  assert.equal(brief.explicit, true);
  assert.equal(brief.payerName, "Aktionariat");
  assert.equal(brief.payerKind, "third-party");
  assert.equal(brief.tagger, "proto_von");
  assert.notEqual(brief.payerName, "proto_von");
  assert.deepEqual(brief.amounts.map((row) => row.amount + " " + row.currency), ["3 ETH", "1 ETH"]);
  assert.equal(brief.email, "bugs@aktionariat.com");
  assert.match(brief.deliverable, /Hardhat PoC against master/);
  assert.match(brief.repo, /github\.com\/aktionariat\/contracts/);
  assert.equal(brief.missing.includes("budget"), false);
  assert.equal(brief.ask, "");
});

test("the dry reply uses the stated ETH tiers and does not ask or lecture", () => {
  const text = draftReply(readBrief(POINTER));
  assert.equal(text, OPENER + " " + FACTS);
  assert.equal(text.length <= 280, true);
  assert.equal(text.includes("\u2014"), false);
  assert.equal(text.includes("\u2013"), false);
  assert.equal(/what budget|what deadline|still just a request|until it(?:'s| is) listed/i.test(text), false);
  assert.match(text, /3 ETH/);
  assert.match(text, /1 ETH/);
  assert.match(text, /bugs@aktionariat.com/);
});

test("a listing link is added without dropping either ETH amount", () => {
  const url = "https://market.near.ai/jobs/dry-run-2121989097954697556";
  const text = draftReply(readBrief(POINTER), { url });
  assert.equal(text, OPENER + " " + FACTS + " Agents can bid here: " + url);
  assert.equal(text.length <= 280, true);
  assert.match(text, /3 ETH/);
  assert.match(text, /1 ETH/);
  assert.equal(text.endsWith(url), true);
});

test("a job with a budget and no deadline asks only for the day", () => {
  const brief = readBrief({
    id: "50",
    username: "ada",
    text: "@clanksmith make a logo for 40 USD",
  });
  assert.equal(brief.explicit, true);
  assert.equal(brief.payerKind, "tagger");
  assert.equal(brief.amounts[0].amount, "40");
  assert.equal(brief.amounts[0].currency, "USD");
  const text = draftReply(brief);
  assert.match(text, /40 USD/);
  assert.match(text, /logo/i);
  assert.match(text, /what day/i);
  assert.equal(/budget/i.test(text), false);
  assert.equal(text.length <= 280, true);
});

test("a job with no budget asks for the budget and nothing else", () => {
  const text = draftReply(readBrief({
    id: "51",
    username: "ada",
    text: "@clanksmith make a logo",
  }));
  assert.match(text, /logo/i);
  assert.match(text, /budget/i);
  assert.equal(/deadline|what day/i.test(text), false);
});
