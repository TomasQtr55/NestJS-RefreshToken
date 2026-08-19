import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { rpcError } from './rpc-error';
import { TokenPair, TokensService } from './tokens.service';

export interface RegisterDto {
  email: string;
  password: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RefreshDto {
  refreshToken: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    this.validateCredentials(dto);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw rpcError(409, 'Email is already registered');
    }

    // bcrypt (factor de costo 10): lento a propósito, para que la fuerza
    // bruta sobre hashes filtrados sea costosa. La contraseña en texto
    // plano nunca se almacena.
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash },
    });

    // El hash de la contraseña NUNCA sale de este servicio — ni siquiera
    // en las respuestas.
    return { id: user.id, email: user.email };
  }

  async login(
    dto: LoginDto,
  ): Promise<TokenPair & { user: { id: string; email: string } }> {
    this.validateCredentials(dto);

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Mismo mensaje de error para "usuario no existe" y "contraseña
    // incorrecta": distinguirlos permitiría a un atacante enumerar
    // emails válidos.
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw rpcError(401, 'Invalid credentials');
    }

    const pair = await this.tokens.issueTokenPair(user);
    return { ...pair, user: { id: user.id, email: user.email } };
  }

  /** La rotación ocurre dentro de TokensService — ver las notas del RFC 9700 ahí. */
  async refresh(dto: RefreshDto): Promise<TokenPair> {
    if (!dto.refreshToken) {
      throw rpcError(400, 'refreshToken is required');
    }
    return this.tokens.rotateRefreshToken(dto.refreshToken);
  }

  async logout(dto: RefreshDto): Promise<{ success: true }> {
    if (!dto.refreshToken) {
      throw rpcError(400, 'refreshToken is required');
    }
    await this.tokens.revokeByPresentedToken(dto.refreshToken);
    return { success: true };
  }

  private validateCredentials(dto: {
    email?: string;
    password?: string;
  }): void {
    if (!dto.email || !EMAIL_REGEX.test(dto.email)) {
      throw rpcError(400, 'A valid email is required');
    }
    if (!dto.password || dto.password.length < MIN_PASSWORD_LENGTH) {
      throw rpcError(
        400,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
      );
    }
  }
}
