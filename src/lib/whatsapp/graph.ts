// One place to talk to the Meta Graph API.
//
// Extracted from templates.ts, which had this as a private helper. `numbers.ts`
// needs exactly the same behaviour — most importantly the same error handling,
// because Meta's refusals are the whole product here: a number that will not
// verify or register says so in `error_user_msg`, and losing that sentence is
// what turns a five-minute fix into a day of guessing.

export interface GraphError {
  error?: { message?: string; error_user_msg?: string; code?: number };
}

export type GraphResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function graph<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<GraphResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return {
      ok: false,
      error:
        err?.name === "TimeoutError"
          ? "Meta did not respond in time."
          : (err?.message ?? "Network error"),
    };
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body — fall through to the raw text as the error.
  }
  if (!res.ok) {
    const g = json as GraphError | null;
    // error_user_msg is the human-readable one Meta shows in its own UI; the
    // generic `message` is usually "(#100) Invalid parameter", which helps nobody.
    return {
      ok: false,
      error:
        g?.error?.error_user_msg ||
        g?.error?.message ||
        text.slice(0, 300) ||
        `HTTP ${res.status}`,
    };
  }
  return { ok: true, data: (json ?? {}) as T };
}
