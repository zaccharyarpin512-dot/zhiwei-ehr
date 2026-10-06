// APP 端 API 客户端（同 Web 端约定：Bearer + 统一错误格式 PRD 9.1）
const TOKEN_KEY = 'zw-token';
export function getToken(): string { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t); }

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as any) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.code !== 0 && body.data === null && !Array.isArray(body))) {
    if (body && (body as any).accessToken) return body as any;
    throw new Error(body?.message || `请求失败（${res.status}）`);
  }
  if (body && 'code' in body && 'data' in body) return body.data as T;
  return body as T;
}
