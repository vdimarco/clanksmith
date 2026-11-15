// Bindings for the X reply path. Secrets are set with `wrangler secret put` and are not in wrangler.jsonc.
export interface XReplyEnv {
  HERMES_API_KEY?: string;
  X_REPLY_MODE?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_API_KEY?: string;
  X_API_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
  X_OAUTH2_USER_TOKEN?: string;
  X_OAUTH2_REFRESH_TOKEN?: string;
  X_BEARER_TOKEN?: string;
  X_REVIEW_TOKEN?: string;
}
