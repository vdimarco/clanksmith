// OAuth 2.0 user-token keeper for @clanksmith.
// One Durable Object calls this, so callers share one refresh. X rotates the
// refresh token on every success, and the new pair is stored before it is used.
// Nothing in this module writes a token to a log.

export const REFRESH_EARLY_MS = 30 * 60 * 1000;
export const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const RECORD_KEY = "oauth2";

export function needsRefresh(record, now, earlyMs = REFRESH_EARLY_MS) {
  if (!record?.refreshToken) return false;
  if (!record.accessToken || !record.expiresAt) return true;
  return record.expiresAt - now <= earlyMs;
}

function seed(env) {
  const accessToken = env?.X_OAUTH2_USER_TOKEN || "";
  const refreshToken = env?.X_OAUTH2_REFRESH_TOKEN || "";
  if (!accessToken && !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt: 0 };
}

function copy(record) {
  if (!record) return null;
  return {
    accessToken: String(record.accessToken || ""),
    refreshToken: String(record.refreshToken || ""),
    expiresAt: Number(record.expiresAt) || 0,
  };
}

async function exchange({ refreshToken, clientId, clientSecret, fetchImpl, now }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: "Basic " + btoa(clientId + ":" + clientSecret),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch {
    const error = new Error("X token refresh failed");
    error.status = 502;
    throw error;
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token || !payload.refresh_token) {
    const error = new Error("X token refresh " + (res.status || "error"));
    error.status = res.status || 502;
    throw error;
  }
  const expiresIn = Number(payload.expires_in);
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 7200;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: now() + seconds * 1000,
  };
}

export function createTokenKeeper({ storage, env = {}, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  let tail = Promise.resolve();
  const exclusive = (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  async function refreshFrom(record) {
    const clientId = env.X_CLIENT_ID || "";
    const clientSecret = env.X_CLIENT_SECRET || "";
    try {
      return await exchange({ refreshToken: record.refreshToken, clientId, clientSecret, fetchImpl, now });
    } catch (error) {
      const fallback = env.X_OAUTH2_REFRESH_TOKEN || "";
      if (fallback && fallback !== record.refreshToken) {
        return exchange({ refreshToken: fallback, clientId, clientSecret, fetchImpl, now });
      }
      throw error;
    }
  }

  return {
    accessToken({ force = false, unacceptable = "" } = {}) {
      return exclusive(async () => {
        let record = copy(await storage.get(RECORD_KEY));
        if (!record) {
          record = seed(env);
          if (record) await storage.put(RECORD_KEY, record);
        }
        if (!record) return null;
        const rejected = Boolean(force && unacceptable && record.accessToken === unacceptable);
        if (record.accessToken && !needsRefresh(record, now()) && !rejected) return record.accessToken;
        if (!record.refreshToken || !env.X_CLIENT_ID || !env.X_CLIENT_SECRET) return record.accessToken || null;
        try {
          const next = await refreshFrom(record);
          await storage.put(RECORD_KEY, next);
          return next.accessToken;
        } catch (error) {
          if (!rejected && record.accessToken && record.expiresAt > now()) return record.accessToken;
          throw error;
        }
      });
    },
  };
}
