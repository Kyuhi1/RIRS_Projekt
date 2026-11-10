export interface ApiResponse {
  status: number;
  data: unknown;
}

async function request(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export const getJson = (path: string) => request('GET', path);
export const postJson = (path: string, body: unknown = {}) => request('POST', path, body);

// Sporočilo o napaki iz odgovora strežnika ({ error }) ali podano nadomestno besedilo.
export function errorMessage(data: unknown, fallback: string): string {
  return data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : fallback;
}
