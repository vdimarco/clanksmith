// Registers https://clanksmith.com/x/webhook and subscribes @clanksmith.
// Reads X_BEARER_TOKEN and X_OAUTH2_USER_TOKEN from the environment.
// Prints the webhook id and subscription ids. Does not print the tokens.
// Pass --dry-run to print the plan without calling X.
import { registerWebhooks } from "../worker/x/register.mjs";

const dryRun = process.argv.includes("--dry-run");
try {
  const summary = await registerWebhooks({ env: process.env, dryRun });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "registration failed");
  process.exit(1);
}
