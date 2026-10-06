// API 客户端：统一 Bearer token 与错误格式（PRD 9.1）
const TOKEN_KEY = 'zw-token';

export function getToken(): string { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export interface ApiResp<T = any> { code: number; message: string; data: T; }

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as any) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const body = (await res.json().catch(() => null)) as ApiResp<T> | null;
  if (!res.ok || (body && body.code !== 0 && body.data === null && !('list' in (body as any)))) {
    // 登录等接口返回 {accessToken} 而非统一格式，宽松处理
    if (body && (body as any).accessToken) return body as any;
    throw new Error(body?.message || `请求失败（${res.status}）`);
  }
  // 统一格式 {code,message,data} 或裸数据（登录响应）
  if (body && 'code' in body && 'data' in body) return body.data as T;
  return body as T;
}

export async function login(mobile: string, password: string) {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || '登录失败');
  return body; // { accessToken, refreshToken }
}
