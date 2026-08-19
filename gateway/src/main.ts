// main.ts corre ANTES de que se inicialicen los módulos de Nest, así que
// el archivo .env se carga manualmente acá (el único archivo permitido
// para tocar process.env).
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // El gateway es la ÚNICA puerta de entrada HTTP pública del sistema.
  // Los clientes nunca ven auth-ms — solo hablan con este proceso.
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`gateway escuchando en http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
