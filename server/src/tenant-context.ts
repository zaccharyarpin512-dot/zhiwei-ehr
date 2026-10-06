// 租户上下文：AsyncLocalStorage 存当前请求的租户/用户（FR-M11-004 地基）
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantCtx {
  tenantId: number;
  userId: number;
  roles: string[];
  empId?: number;
}

export const tenantALS = new AsyncLocalStorage<TenantCtx>();

export function ctx(): TenantCtx | undefined {
  return tenantALS.getStore();
}

export function mustCtx(): TenantCtx {
  const c = ctx();
  if (!c) throw new Error('NO_TENANT_CONTEXT');
  return c;
}
