export interface ApiResponse {
  status: number;
  data: unknown;
}

export async function postJson(path: string, body: unknown): Promise<ApiResponse> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
