/** Redact sensitive tokens for safe logging. */
export function redactToken(token?: string): string {
  if (!token) return "(none)";
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

/** Redact URL query parameters for safe logging. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((_v, k) => parsed.searchParams.set(k, "***"));
    return parsed.toString();
  } catch {
    return url.slice(0, 50) + "...";
  }
}

/** Redact body content for safe logging. */
export function redactBody(body: string): string {
  if (body.length <= 200) return body.slice(0, 100);
  return body.slice(0, 100) + "...(truncated)";
}
