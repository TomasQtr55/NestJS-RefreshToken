import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

/**
 * JwtAuthGuard — verifica el access token LOCALMENTE.
 *
 * Este es el punto entero de usar JWTs en una arquitectura de
 * microservicios: el gateway NO llama a auth-ms para validar cada
 * request. El token es autocontenido y autofirmado — cualquiera que
 * tenga el secreto compartido puede verificarlo sin ningún salto de
 * red. Eso es lo que permite escalar servicios sin saturar al servicio
 * de autenticación en cada request.
 *
 * El tradeoff (explicado en el documento de diseño): un JWT no se puede
 * revocar individualmente antes de que expire. Por eso el TTL del
 * access token es de solo 15 minutos, y por eso el REFRESH token
 * revocable vive en la base de datos de auth-ms.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();

    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      // Verificación de firma + expiración, totalmente local.
      request.user = await this.jwt.verifyAsync(token);
    } catch (error) {
      // Distinguir "expirado" de "forjado" ayuda a los clientes a
      // reaccionar correctamente: expirado → usar el refresh token;
      // forjado → volver a loguearse.
      const isExpired = (error as Error).name === 'TokenExpiredError';
      throw new UnauthorizedException(
        isExpired ? 'Access token expired' : 'Invalid access token',
      );
    }

    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    return header.slice('Bearer '.length).trim() || null;
  }
}
