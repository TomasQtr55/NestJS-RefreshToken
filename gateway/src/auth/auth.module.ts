import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersController } from './users.controller';

@Module({
  imports: [
    // Cliente TCP hacia auth-ms. El gateway NUNCA consulta la base de
    // datos: cada operación de autenticación es un mensaje enviado a
    // través de este proxy.
    ClientsModule.registerAsync([
      {
        name: 'AUTH_MS',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('AUTH_MS_HOST', '127.0.0.1'),
            port: Number(config.get('AUTH_MS_PORT', 3001)),
          },
        }),
      },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Mismo secreto compartido que auth-ms (HS256). El gateway solo
        // VERIFICA; nunca firma tokens. Ver el guard para entender por
        // qué esta verificación local es la clave para escalar
        // microservicios.
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [JwtAuthGuard],
})
export class AuthModule {}
