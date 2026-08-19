import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Secreto compartido HS256. El MISMO secreto vive en el gateway,
        // que verifica tokens localmente. Camino de upgrade (producción):
        // RS256 — auth-ms firmaría con una clave privada y los demás
        // servicios verificarían solo con la pública.
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          // TTL corto a propósito: los access tokens no se pueden revocar
          // individualmente, así que su tiempo de vida acota el daño de
          // una filtración.
          //
          // GOTCHA: las variables de entorno siempre son strings. Si
          // "900" llega a jsonwebtoken como STRING, lo parsea con la
          // librería `ms` como 900 MILISEGUNDOS — el token nace expirado.
          // Number() acá no es opcional.
          expiresIn: Number(config.get<string>('JWT_ACCESS_TTL') ?? '900'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokensService],
})
export class AuthModule {}
