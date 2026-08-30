type ApiErrorBody = { error?: string };

export async function requestControlPlaneJson<T>(
  apiBase: string,
  path: string,
  csrfToken: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(csrfToken && !['GET', 'HEAD'].includes(method) ? { 'x-casioplus-csrf': csrfToken } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `request_failed_${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
