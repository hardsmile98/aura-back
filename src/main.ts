import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { I18nValidationExceptionFilter, I18nValidationPipe } from 'nestjs-i18n';
import type { ValidationError } from 'class-validator';

function getAllErrorMessages(errors: ValidationError[]): string[] {
  const messages: string[] = [];

  for (const error of errors) {
    if (error.constraints) {
      messages.push(...Object.values(error.constraints));
    }
    if (error.children?.length) {
      messages.push(...getAllErrorMessages(error.children));
    }
  }
  return messages;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.useGlobalFilters(
    new I18nValidationExceptionFilter({
      errorFormatter: (errors) => ({ messages: getAllErrorMessages(errors) }),

      responseBodyFormatter: (_host, exc, formattedErrors) => {
        const { messages } = formattedErrors as { messages: string[] };

        return {
          statusCode: exc.getStatus(),
          message: messages.length === 1 ? messages[0] : messages,
        };
      },
    }),
  );

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
