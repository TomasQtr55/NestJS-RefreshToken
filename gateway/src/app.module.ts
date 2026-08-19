import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Carga .env y expone ConfigService globalmente.
    // NOTA: este .env NO tiene URL de base de datos NI configuración de
    // refresh token — el gateway no los necesita. Ese aislamiento es el
    // límite de microservicio hecho visible.
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
  ],
})
export class AppModule {}
