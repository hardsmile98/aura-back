import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { I18nValidationExceptionFilter, I18nValidationPipe } from 'nestjs-i18n';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new I18nValidationExceptionFilter());

  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = +(process.env.APP_PORT ?? 3000);

  app.enableCors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  await app.listen(port);
}

void bootstrap();
