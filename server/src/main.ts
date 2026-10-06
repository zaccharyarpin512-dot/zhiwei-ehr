// BigInt 序列化垫片（PRD 9.1：BigInt 主键→JSON number）
(BigInt.prototype as any).toJSON = function () { return Number(this); };
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { registerExceptionFilter } from './common/guards';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(''); // 前缀已在各控制器内（api/v1/...）
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  registerExceptionFilter(app);
  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`zhiwei-ehr api listening on :${port}`);
}
if (require.main === module) bootstrap();
export { bootstrap };
