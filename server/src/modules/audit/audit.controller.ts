// M11 审计查询（FR-M11-003：HR 可查，append-only）
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { PrismaService } from '../../prisma.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/audit-logs')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Roles('hr_admin', 'super_admin')
  async list(
    @Query('user_id') userId?: string,
    @Query('resource_type') resourceType?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('page') page = '1',
    @Query('page_size') pageSize = '20',
  ) {
    const where: any = {};
    if (userId) where.userId = Number(userId);
    if (resourceType) where.resourceType = resourceType;
    if (start || end) where.createdAt = {};
    if (start) where.createdAt.gte = new Date(start);
    if (end) where.createdAt.lte = new Date(end);
    const p = Math.max(1, Number(page)), ps = Math.min(100, Number(pageSize));
    const [list, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (p - 1) * ps, take: ps }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { list: list.map((l) => ({ ...l, id: Number(l.id) })), total, page: p, page_size: ps };
  }
}
