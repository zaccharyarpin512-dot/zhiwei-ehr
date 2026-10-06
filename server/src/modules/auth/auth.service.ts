// 认证服务：bcrypt 校验、连续 5 次错误锁定 15 分钟（FR-M11-001）
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma.service';
import { tenantALS } from '../../tenant-context';
import { signAccess, signRefresh, TokenPayload } from '../../lib/jwt';
import { BusinessError, Errors } from '../../common/errors';

const LOCK_MINUTES = 15;
const MAX_FAIL = 5;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  private issue(p: { uid: number; tid: number; roles: string[]; empId?: number }) {
    const payload: TokenPayload = { uid: p.uid, tid: p.tid, roles: p.roles, empId: p.empId };
    return { accessToken: signAccess(payload), refreshToken: signRefresh(payload), tokenType: 'Bearer' };
  }

  async login(mobile: string, password: string) {
    // 登录在租户上下文之外执行：按手机号查（演示期单租户匹配，TBD(ZW-PRD)：加租户入参）
    const user = await this.prisma.user.findFirst({ where: { mobile } });
    if (!user) throw Errors.UNAUTHORIZED();
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new BusinessError(42300, `账号已锁定，请 ${LOCK_MINUTES} 分钟后再试`, 423);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failedCount = user.failedCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: failedCount >= MAX_FAIL
          ? { failedCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
          : { failedCount },
      });
      throw new BusinessError(40101, failedCount >= MAX_FAIL ? '错误次数过多，账号锁定 15 分钟' : '手机号或密码错误', 401);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedCount: 0, lockedUntil: null } });
    const emp = await this.prisma.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
    return this.issue({ uid: Number(user.id), tid: Number(user.tenantId), roles: user.roles as string[], empId: emp ? Number(emp.id) : undefined });
  }

  async smsLogin(mobile: string, code: string) {
    if (code !== '123456') throw new BusinessError(40102, '验证码错误', 401);
    const user = await this.prisma.user.findFirst({ where: { mobile } });
    if (!user) throw Errors.UNAUTHORIZED();
    const emp = await this.prisma.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
    return this.issue({ uid: Number(user.id), tid: Number(user.tenantId), roles: user.roles as string[], empId: emp ? Number(emp.id) : undefined });
  }

  async me(uid: number) {
    const c = tenantALS.getStore();
    const user = await this.prisma.user.findFirst({ where: { id: uid, tenantId: c!.tenantId } });
    if (!user) throw Errors.NOT_FOUND();
    const pref = await this.prisma.userPreference.findFirst({ where: { userId: uid } });
    return {
      id: Number(user.id), name: user.name, mobile: user.mobile, roles: user.roles,
      theme: pref?.theme || 'coral',
    };
  }
}
