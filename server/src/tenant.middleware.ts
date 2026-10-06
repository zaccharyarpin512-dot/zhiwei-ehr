// 全局租户中间件：从 JWT 解析租户/用户上下文，整个请求在 ALS 中执行（FR-M11-004 地基）
import { Injectable, NestMiddleware } from '@nestjs/common';
import { tenantALS } from './tenant-context';
import { verify } from './lib/jwt';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    const h: string = req.headers['authorization'] || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    let store: any = undefined;
    if (token) {
      try {
        const p = verify(token);
        store = { tenantId: p.tid, userId: p.uid, roles: p.roles, empId: p.empId };
      } catch { /* 无效 token：无上下文，由 AuthGuard 统一拒绝 */ }
    }
    if (!store) return next();
    return tenantALS.run(store, () => next());
  }
}
