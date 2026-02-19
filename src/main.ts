import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { I18nValidationPipe } from 'nestjs-i18n';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = +(process.env.APP_PORT ?? 3000);

  await app.listen(port);
}

void bootstrap();
