// 认证模块（FR-M11-001）：密码登录 + 验证码登录（短信适配层，联调期固定码）+ 锁定策略
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsMobilePhone, IsString, MinLength } from 'class-validator';
import { AuthGuard, Public } from '../../common/guards';
import { AuthService } from './auth.service';

export class LoginDto {
  @IsMobilePhone('zh-CN', {}, { message: '手机号格式不正确' })
  mobile: string;
  @IsString() @MinLength(6, { message: '密码至少 6 位' })
  password: string;
}
export class SmsLoginDto {
  @IsMobilePhone('zh-CN', {}, { message: '手机号格式不正确' })
  mobile: string;
  @IsString() code: string;
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(private svc: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto.mobile, dto.password);
  }

  // 短信适配层：联调期返回固定验证码 123456（TBD(ZW-PRD)：接真实短信服务商）
  @Public()
  @Post('sms-code')
  smsCode(@Body() body: { mobile: string }) {
    return { code: 0, message: '验证码已发送（联调期固定 123456）', data: { mock: true } };
  }

  @Public()
  @Post('login-sms')
  smsLogin(@Body() dto: SmsLoginDto) {
    return this.svc.smsLogin(dto.mobile, dto.code);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.svc.me(req.user.uid);
  }
}
