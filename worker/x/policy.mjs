// Reply policy for @clanksmith. Templates only. No model call.
// A reply teaches the public loop. It never accepts work or quotes a price.

export const BOT_USER_ID = "1065743939729309697";

const FACTS = "Tag @clanksmith with the job, your budget, and your deadline. Agents bid, and you check the work before anyone is paid.";
const BETA = "Beta, so a post is a request until it is listed on NEAR AI Agent Market.";

export const REPLIES = {
  what: `Clanksmith is how you hire an AI agent from a post on X. ${FACTS} ${BETA} https://clanksmith.com`,
  post: `To post a job, tag @clanksmith with the job, your budget, and your deadline. Agents bid, and you check the work before anyone is paid. ${BETA} https://clanksmith.com`,
  bid: `Agents bid after you post the job. ${FACTS} ${BETA} https://clanksmith.com/board/`,
  hire: `To hire an agent, tag @clanksmith with the job, your budget, and your deadline. Agents bid, and you check the work before anyone is paid. ${BETA} https://clanksmith.com`,
};

for (const [name, text] of Object.entries(REPLIES)) {
  if (text.length > 280) throw new Error("reply template " + name + " is " + text.length + " characters");
}

const HOSTILE = /\b(fuck|fucking|shit|asshole|bitch|idiot|moron|trash|kys|kill yourself)\b/i;
const SPAM = /\b(giveaway|airdrop|referral|promo code|follow me|follow back|onlyfans|casino|whitelist|telegram|free followers|check my bio|100x)\b|t\.me\//i;
const SECRETS = /\b(wallet|private key|seed phrase|secret key|mnemonic|api key)\b/i;
const REFUND = /\b(refund|chargeback|dispute|disputes)\b/i;
const PAYOUT = /\b(payout|guarantee|promise)\b/i;
const PRICE = /\b(how much|your price|do you charge|what do you charge|quote me|send a quote)\b/i;
const ACCEPT = /\b(accept (this|the) job|can you (accept|do|take|build|make)|will you (do|take|build|make)|i('m| am) hiring you)\b/i;
const BID = /\bhow (do|does) agents bid\b|\bhow (do|does) bidding work\b/i;
const POST = /\bhow (do i |do we |to |can i )?post a job\b/i;
const WHAT = /\bwhat is (clanksmith|this)\b|\bwho are you\b|\bwhat do you do\b/i;
const HIRE = /\b(i want to hire|want to hire|hire an agent|looking to hire|need an agent)\b/i;

function review(reason) {
  return { action: "review", reason };
}

function ignore(reason) {
  return { action: "ignore", reason };
}

function reply(reason) {
  return { action: "reply", reason, text: REPLIES[reason] };
}

export function decide(event) {
  if (String(event.authorId || "") === BOT_USER_ID) return ignore("self");
  if (event.encrypted || event.kind === "chat") return review("encrypted");
  if (event.isRetweet || /^RT @/i.test(event.text || "")) return ignore("retweet");
  if (event.isQuote) return ignore("quote");
  const text = String(event.text || "").trim();
  if (!text) return ignore("empty");
  if (HOSTILE.test(text)) return ignore("hostile");
  if (SPAM.test(text)) return ignore("spam");
  if (REFUND.test(text)) return review("refund");
  if (SECRETS.test(text)) return review("secrets");
  if (PAYOUT.test(text)) return review("payout");
  if (PRICE.test(text)) return review("price");
  if (ACCEPT.test(text)) return review("accept");
  if (BID.test(text)) return reply("bid");
  if (POST.test(text)) return reply("post");
  if (WHAT.test(text)) return reply("what");
  if (HIRE.test(text)) return reply("hire");
  if (/\b(budget|deadline)\b/i.test(text) && /\b(logo|job|hire|agent|make|build|need)\b/i.test(text)) return reply("hire");
  return ignore("none");
}
