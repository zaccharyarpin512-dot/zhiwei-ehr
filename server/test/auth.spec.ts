// WP-3 验收：登录、连续 5 次错误锁定 15 分钟、验证码登录、/me
import { INestApplication } from '@nestjs/common';
import request from "supertest";
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('认证（FR-M11-001）', () => {
  let app: INestApplication;
  let s: any;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { s = await seedTenant(app); });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const mobile = (token: string) => token; // 占位，实际手机号从 seed 推不出，直接查库
  async function mobileOf(uid: number) {
    const { PrismaClient } = require('@prisma/client');
    const prisma = app.get(PrismaService) as any;
    const u = await prisma.user.findFirst({ where: { id: uid } });
    return u.mobile;
  }

  it('正确密码登录 → 返回 access/refresh token', async () => {
    const m = await mobileOf(s.hrUserId);
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile: m, password: 'Passw0rd!' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it('错误密码累计 5 次 → 第 5 次锁定并提示 15 分钟', async () => {
    const m = await mobileOf(s.empUserId);
    for (let i = 1; i <= 4; i++) {
      const r = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile: m, password: 'WrongPass1' });
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('手机号或密码错误');
    }
    const r5 = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile: m, password: 'WrongPass1' });
    expect(r5.status).toBe(401);
    expect(r5.body.message).toContain('锁定 15 分钟');
    // 锁定期间即使密码正确也拒绝（423）
    const r6 = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ mobile: m, password: 'Passw0rd!' });
    expect([423, 401]).toContain(r6.status);
    expect(r6.body.message).toContain('锁定');
  });

  it('验证码登录：联调期固定码 123456', async () => {
    const m = await mobileOf(s.empUserId);
    const ok = await request(app.getHttpServer()).post('/api/v1/auth/login-sms').send({ mobile: m, code: '123456' });
    expect(ok.status).toBe(201);
    expect(ok.body.accessToken).toBeTruthy();
    const bad = await request(app.getHttpServer()).post('/api/v1/auth/login-sms').send({ mobile: m, code: '000000' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe(40102);
  });

  it('未登录访问受保护接口 → 401 统一格式', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/departments');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe(40100);
  });

  it('/me 返回用户信息与皮肤偏好（默认 coral）', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', s.empToken);
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('李四');
    expect(r.body.theme).toBe('coral');
  });
});
