import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

/**
 * Endpoints HTTP públicos de autenticación. Cada uno simplemente reenvía
 * el comando a auth-ms por TCP y traduce el contrato de errores del
 * microservicio ({ statusCode, message }) de vuelta a códigos HTTP
 * reales.
 */
@Controller('auth')
export class AuthController {
  constructor(
    @Inject('AUTH_MS') private readonly authClient: ClientProxy,
  ) {}

  @Post('register')
  register(@Body() body: unknown) {
    return this.sendToAuthMs('auth.register', body);
  }

  @Post('login')
  login(@Body() body: unknown) {
    return this.sendToAuthMs('auth.login', body);
  }

  @Post('refresh')
  refresh(@Body() body: unknown) {
    return this.sendToAuthMs('auth.refresh', body);
  }

  @Post('logout')
  logout(@Body() body: unknown) {
    return this.sendToAuthMs('auth.logout', body);
  }

  private async sendToAuthMs<T>(pattern: string, payload: unknown): Promise<T> {
    try {
      return await lastValueFrom(this.authClient.send<T>(pattern, payload));
    } catch (error) {
      const rpcError = error as { statusCode?: number; message?: string };

      // Los errores que vienen DE auth-ms traen nuestro contrato:
      // conservamos su status.
      if (typeof rpcError?.statusCode === 'number') {
        throw new HttpException(
          rpcError.message ?? 'Authentication error',
          rpcError.statusCode,
        );
      }

      // Sin statusCode → la falla es a nivel de transporte
      // (auth-ms está caído o inalcanzable). Nunca filtrar un 500 crudo.
      throw new HttpException(
        'Authentication service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
