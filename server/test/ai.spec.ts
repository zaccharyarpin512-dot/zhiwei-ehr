// WP-37~40 AI 辅助验收：护栏/指标建议/润色/评价草稿/可关闭/留痕
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('WP-37~40 AI 辅助（FR-M13 + 硬护栏）', () => {
  let app: INestApplication; let s: any; let prisma: any;
  beforeAll(async () => { app = await buildApp(); prisma = app.get(PrismaService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { s = await seedTenant(app); });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('指标建议：关键词命中出候选（带采纳标记/口径/计分规则），响应无分数字段（UAT 12-①）+ 留痕（12-④）', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/ai/indicators/suggest').set('Authorization', s.hrToken)
      .send({ duty: '负责销售回款与新增客户' }).expect(201);
    expect(r.body.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(r.body.suggestions[0].name).toBe('季度回款额');
    expect(r.body.suggestions[0].aiAssisted).toBe(true);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('"finalScore"');
    expect(raw).not.toContain('"grade"');
    const log = await prisma.$queryRawUnsafe(`SELECT scene FROM ai_invocation_log WHERE tenant_id=$1`, s.tenantId);
    expect((log as any)[0].scene).toBe('indicator_suggest');
  });

  it('WP-39/40：SMART 润色给 issues+改写版；评价草稿含 5 段提纲且无分数', async () => {
    const p = await request(app.getHttpServer()).post('/api/v1/ai/goals/polish').set('Authorization', s.hrToken).send({ duty: '提升客户满意度' }).expect(201);
    expect(p.body.issues.length).toBeGreaterThanOrEqual(2);
    expect(p.body.versions.length).toBe(1);
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: 'S', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q4', period: '2026Q4', startDate: new Date('2026-10-01'), endDate: new Date('2026-12-31'), status: 'RUNNING' } });
    const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: 1, status: 'manager_review' } });
    const d = await request(app.getHttpServer()).post('/api/v1/ai/reviews/draft').set('Authorization', s.hrToken).send({ recordId: Number(rec.id) }).expect(201);
    expect(d.body.draft.aiAssisted).toBe(true);
    expect(d.body.draft.talkOutline.length).toBe(5);
    expect(JSON.stringify(d.body)).not.toContain('"grade"');
  });

  it('employee 无权调用；租户关闭 AI 后 40401（UAT 12-③）', async () => {
    await request(app.getHttpServer()).post('/api/v1/ai/indicators/suggest').set('Authorization', s.empToken).send({ duty: '销售' }).expect(403);
    await prisma.$executeRawUnsafe(`INSERT INTO ai_config (tenant_id,enabled,provider) VALUES ($1,false,'builtin') ON CONFLICT (tenant_id) DO UPDATE SET enabled=false`, s.tenantId);
    const r = await request(app.getHttpServer()).post('/api/v1/ai/indicators/suggest').set('Authorization', s.hrToken).send({ duty: '销售' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe(40401);
  });
});
