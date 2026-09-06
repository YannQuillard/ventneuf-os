function firstHeaderValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const requestUrl = new URL(request.url);
    const host = firstHeaderValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
    const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.slice(0, -1);
    const expectedOrigin = host ? `${protocol}://${host}` : requestUrl.origin;
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}
