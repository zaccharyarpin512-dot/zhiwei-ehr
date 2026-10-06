// AuthGuard + RolesGuard（服务端强制校验，FR-M11-002）
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verify } from '../lib/jwt';
import { BusinessError, Errors } from './errors';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers['authorization'] || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw Errors.UNAUTHORIZED();
    try {
      const p = verify(token);
      req.user = p; // { uid, tid, roles, empId }
      return true;
    } catch {
      throw Errors.UNAUTHORIZED();
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const need = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!need || need.length === 0) return true;
    const req = ctx.switchToHttp().getRequest();
    const roles: string[] = req.user?.roles || [];
    if (need.some((r) => roles.includes(r))) return true;
    throw Errors.FORBIDDEN();
  }
}

// 业务异常 → PRD 9.1 统一响应格式 { code, message, data }
export function registerExceptionFilter(app: any) {
  const { BaseExceptionFilter } = require('@nestjs/core');
  class Filter extends BaseExceptionFilter {
    catch(e: any, host: any) {
      const res = host.switchToHttp().getResponse();
      if (e instanceof BusinessError) {
        return res.status(e.httpStatus).json({ code: e.code, message: e.message, data: null });
      }
      if (e?.status === 403) return res.status(403).json({ code: 40300, message: '无权操作', data: null });
      if (e?.status === 404) return res.status(404).json({ code: 40400, message: '资源不存在', data: null });
      if (e?.status === 400 && Array.isArray(e?.response?.message)) {
        return res.status(400).json({ code: 40000, message: e.response.message.join('；'), data: null });
      }
      console.error('[FILTER-500]', e); // 未知错误：日志留内部，响应不泄露细节
      return res.status(500).json({ code: 50000, message: '系统错误', data: null });
    }
  }
  app.useGlobalFilters(new Filter());
}
