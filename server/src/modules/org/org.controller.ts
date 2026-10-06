// M01 组织与人员（FR-M01-001/002/003）：部门树 + 员工 + Excel 批量导入
import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Response } from 'express';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { OrgService } from './org.service';

export class DeptDto {
  @IsString() @IsNotEmpty() code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() parentId?: number;
  @IsOptional() managerUserId?: number;
  @IsOptional() sortNo?: number;
}
export class EmployeeDto {
  @IsString() @IsNotEmpty() empNo: string;
  @IsString() @IsNotEmpty() name: string;
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' }) mobile: string;
  @IsOptional() email?: string;
  @IsNotEmpty() hireDate: string;
  @IsOptional() departmentId?: number;
  @IsString() @IsNotEmpty() position: string;
  @IsOptional() jobLevel?: string;
  @IsOptional() managerEmpId?: number;
}

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class OrgController {
  constructor(private svc: OrgService) {}

  // ---------- 部门 ----------
  @Get('departments')
  tree() { return this.svc.deptTree(); }

  @Post('departments')
  @Roles('hr_admin')
  createDept(@Body() dto: DeptDto) { return this.svc.createDept(dto); }

  @Put('departments/:id')
  @Roles('hr_admin')
  updateDept(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<DeptDto>) {
    return this.svc.updateDept(id, dto);
  }

  @Delete('departments/:id')
  @Roles('hr_admin')
  removeDept(@Param('id', ParseIntPipe) id: number) { return this.svc.removeDept(id); }

  // ---------- 员工 ----------
  @Get('employees')
  listEmp(
    @Query('dept_id') deptId?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('page_size') pageSize = '20',
  ) {
    return this.svc.listEmp({ deptId: deptId ? Number(deptId) : undefined, keyword, status, page: +page, pageSize: +pageSize });
  }

  @Post('employees')
  @Roles('hr_admin')
  createEmp(@Body() dto: EmployeeDto) { return this.svc.createEmp(dto); }

  @Put('employees/:id')
  @Roles('hr_admin')
  updateEmp(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<EmployeeDto>) {
    return this.svc.updateEmp(id, dto);
  }

  @Post('employees/import')
  @Roles('hr_admin')
  @UseInterceptors(FileInterceptor('file'))
  async importEmp(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('缺少上传文件');
    return this.svc.importEmp(file.buffer);
  }

  @Get('employees/import-template')
  @Roles('hr_admin')
  async importTemplate(@Res() res: Response) {
    const buf = await this.svc.importTemplate();
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename=employee_import_template.xlsx' });
    res.send(buf);
  }
}
