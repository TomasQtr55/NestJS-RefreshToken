import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global() permite inyectar PrismaService en cualquier módulo sin tener
 * que importar PrismaModule explícitamente. En este sistema hay una sola
 * base de datos y pertenece a auth-ms — hacerla global refleja esa
 * propiedad de forma explícita.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
