// main.ts corre ANTES de que se inicialice cualquier módulo de Nest, así
// que ConfigModule todavía no cargó el archivo .env en este punto. Lo
// cargamos manualmente acá — este es el único archivo permitido para
// tocar process.env directamente.
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // createMicroservice — NO create(). Acá no hay listener HTTP:
  // el mundo exterior no puede llegar a auth-ms directamente. Solo el
  // gateway (o cualquier cliente interno de confianza) puede hablarle
  // por TCP.
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.AUTH_MS_HOST ?? '127.0.0.1',
        port: Number(process.env.AUTH_MS_PORT ?? 3001),
      },
    },
  );

  await app.listen();
  Logger.log(
    `auth-ms escuchando en TCP ${process.env.AUTH_MS_HOST ?? '127.0.0.1'}:${process.env.AUTH_MS_PORT ?? 3001}`,
    'Bootstrap',
  );
}

void bootstrap();
