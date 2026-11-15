// Cron entry. Refreshes the user token when it is due. The log never includes a token.
export async function warmScheduled(env, deps = {}) {
  try {
    let token = null;
    if (deps.accessToken) token = await deps.accessToken();
    else if (env?.X_INBOX) {
      const { durableInbox } = await import("./object.mjs");
      token = await durableInbox(env.X_INBOX).accessToken();
    }
    console.log(JSON.stringify({ event: "x.oauth.warm", ok: true, present: Boolean(token) }));
  } catch (error) {
    console.log(JSON.stringify({ event: "x.oauth.warm", ok: false, status: error.status || 0 }));
  }
}
