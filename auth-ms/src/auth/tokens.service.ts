import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RefreshToken, User } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { rpcError } from './rpc-error';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * TokensService — el corazón del patrón de refresh token.
 *
 * Acá conviven dos artefactos muy distintos:
 *
 * 1. ACCESS TOKEN (JWT, 15 min): stateless, autocontenido, NO se guarda
 *    en ningún lado. Cualquier servicio que tenga el secreto compartido
 *    puede verificarlo localmente. No se puede revocar individualmente —
 *    por eso su TTL es corto.
 *
 * 2. REFRESH TOKEN (opaco, 7 días): stateful, guardado (hasheado) en la
 *    base de datos, rotable y revocable. Es el "interruptor de apagado"
 *    de la sesión.
 *
 * La rotación + detección de reuso implementada abajo sigue el
 * RFC 9700 (OAuth 2.0 Security BCP, enero 2025) §4.14.2.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Firma un JWT de vida corta. El payload se mantiene mínimo: sub + email. */
  signAccessToken(user: Pick<User, 'id' | 'email'>): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, email: user.email });
  }

  /**
   * ¿Por qué SHA-256 y no bcrypt acá? bcrypt es INTENCIONALMENTE LENTO
   * para resistir fuerza bruta sobre secretos de baja entropía
   * (contraseñas humanas). Los refresh tokens son 48 bytes aleatorios
   * (~384 bits de entropía): la fuerza bruta es imposible, así que un
   * hash rápido alcanza — y nos permite buscar el token por su hash
   * directamente.
   *
   * El token en texto plano NUNCA se guarda: si la base de datos se
   * filtra, solo se filtran hashes inútiles (misma filosofía que el
   * almacenamiento de contraseñas).
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Crea un nuevo registro de refresh token y devuelve el token EN TEXTO
   * PLANO (el único momento en que existe del lado del servidor) junto
   * con el registro persistido.
   *
   * `familyId` agrupa toda la cadena de rotaciones de una sesión de
   * login (RFC 9700 §4.14.2: "se retiene información sobre la relación").
   * Un login nuevo empieza una familia nueva; cada rotación mantiene la
   * misma familia.
   */
  private async createRefreshToken(
    userId: string,
    familyId: string,
  ): Promise<{ plaintext: string; record: RefreshToken }> {
    // 48 bytes criptográficamente aleatorios → opaco, imposible de adivinar, seguro para URLs.
    const plaintext = randomBytes(48).toString('base64url');
    const ttlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);

    const record = await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashRefreshToken(plaintext),
        familyId,
        userId,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });

    return { plaintext, record };
  }

  /** Camino de login / registro: familia nueva, par fresco. */
  async issueTokenPair(
    user: Pick<User, 'id' | 'email'>,
  ): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(user);
    const { plaintext } = await this.createRefreshToken(
      user.id,
      randomUUID(), // login nuevo = familia nueva
    );
    return { accessToken, refreshToken: plaintext };
  }

  /**
   * Camino de refresh — ROTACIÓN según RFC 9700 §4.14.2:
   * "el servidor de autorización emite un nuevo refresh token con cada
   * respuesta de refresh de access token. El refresh token anterior se
   * invalida".
   *
   * DETECCIÓN DE REUSO: si un cliente presenta un token que ya fue
   * rotado (replacedById está seteado), alguien está reutilizando un
   * token viejo. No podemos saber si es el atacante o el usuario
   * legítimo — así que revocamos TODA la familia. El atacante pierde
   * acceso; el usuario legítimo simplemente vuelve a loguearse. Ese
   * tradeoff es exactamente lo que recomienda el RFC.
   */
  async rotateRefreshToken(presentedToken: string): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashRefreshToken(presentedToken) },
      include: { user: true },
    });

    // Tokens desconocidos / expirados / revocados se rechazan simplemente.
    if (!stored) {
      throw rpcError(401, 'Invalid refresh token');
    }
    if (stored.revokedAt) {
      throw rpcError(401, 'Refresh token has been revoked');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw rpcError(401, 'Refresh token has expired');
    }

    if (stored.replacedById) {
      // ⚠️ SEÑAL DE ROBO: este token ya fue rotado una vez. Token válido,
      // pero ningún cliente legítimo debería volver a presentarlo jamás.
      await this.revokeFamily(stored.familyId);
      throw rpcError(
        401,
        'Refresh token reuse detected — the whole session was revoked',
      );
    }

    // Camino feliz: emitir el sucesor dentro de la MISMA familia y marcar
    // este token como reemplazado (invalidado pero trazable — ese vínculo
    // es lo que hace posible la detección de reuso).
    const { plaintext, record: successor } = await this.createRefreshToken(
      stored.userId,
      stored.familyId,
    );
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedById: successor.id },
    });

    const accessToken = await this.signAccessToken(stored.user);
    return { accessToken, refreshToken: plaintext };
  }

  /** Revoca todos los tokens aún activos de una familia (logout / robo). */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Logout: revoca la familia a la que pertenece el token presentado.
   * Idempotente a propósito: un token desconocido también devuelve éxito,
   * para que el endpoint nunca filtre si un token existe o no.
   */
  async revokeByPresentedToken(presentedToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashRefreshToken(presentedToken) },
    });
    if (stored) {
      await this.revokeFamily(stored.familyId);
    }
  }
}
