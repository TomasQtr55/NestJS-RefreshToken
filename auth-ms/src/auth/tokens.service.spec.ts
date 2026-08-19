import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { RefreshToken, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TokensService } from './tokens.service';

/**
 * Unit tests for the refresh token lifecycle. PrismaService is mocked:
 * these tests prove the LOGIC (rotation, reuse detection, hash-only
 * storage), not the database. The real DB flow is covered by the manual
 * e2e sequence documented in the verify phase.
 */
describe('TokensService', () => {
  const user: User = {
    id: 'user-1',
    email: 'a@b.com',
    passwordHash: 'hashed',
    createdAt: new Date(),
  };

  const storedToken = (
    overrides: Partial<RefreshToken> = {},
  ): RefreshToken & { user: User } => ({
    id: 'rt-1',
    tokenHash: 'stored-hash',
    familyId: 'family-1',
    userId: user.id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    revokedAt: null,
    replacedById: null,
    createdAt: new Date(),
    user,
    ...overrides,
  });

  let service: TokensService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwt: JwtService;

  beforeEach(() => {
    prisma = {
      refreshToken: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'rt-2', ...data }),
        ),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    // Real JwtService with a test secret: we want to prove the access
    // token is a real, verifiable JWT with the right TTL and payload.
    jwt = new JwtService({
      secret: 'test-secret',
      signOptions: { expiresIn: 900 },
    });
    const config = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    };
    service = new TokensService(
      prisma as unknown as PrismaService,
      jwt,
      config as unknown as ConfigService,
    );
  });

  describe('hashRefreshToken', () => {
    it('produces a deterministic 64-char hex SHA-256 hash', () => {
      const hash = service.hashRefreshToken('token-abc');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).toBe(service.hashRefreshToken('token-abc'));
      expect(hash).not.toBe(service.hashRefreshToken('other-token'));
    });
  });

  describe('issueTokenPair', () => {
    it('returns a verifiable JWT (sub, email, 15 min TTL) and an opaque refresh token', async () => {
      const pair = await service.issueTokenPair(user);

      const payload = await jwt.verifyAsync(pair.accessToken);
      expect(payload.sub).toBe(user.id);
      expect(payload.email).toBe(user.email);
      expect(payload.exp - payload.iat).toBe(900);

      // Opaque: no JWT structure, long and random.
      expect(pair.refreshToken.split('.')).toHaveLength(1);
      expect(pair.refreshToken.length).toBeGreaterThanOrEqual(48);
    });

    it('persists only the HASH of the refresh token, never the plaintext', async () => {
      const pair = await service.issueTokenPair(user);

      const createArg = prisma.refreshToken.create.mock.calls[0][0];
      expect(createArg.data.tokenHash).toBe(
        service.hashRefreshToken(pair.refreshToken),
      );
      // The plaintext token must not appear anywhere in the persisted data.
      expect(JSON.stringify(createArg.data)).not.toContain(pair.refreshToken);
      // A login starts a NEW family.
      expect(createArg.data.familyId).toBeTruthy();
    });
  });

  describe('rotateRefreshToken', () => {
    it('rotates: marks the old token as replaced and issues a new pair in the SAME family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(storedToken());

      const pair = await service.rotateRefreshToken('presented-token');

      // Lookup happens by hash — the plaintext never reaches the DB.
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: service.hashRefreshToken('presented-token') },
        }),
      );
      // Successor created inside the same family.
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ familyId: 'family-1' }) }),
      );
      // Old token invalidated via replacedById (kept for reuse detection).
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { replacedById: 'rt-2' },
      });
      expect(pair.accessToken).toBeTruthy();
      expect(pair.refreshToken).toBeTruthy();
    });

    it('REUSE DETECTION: an already-rotated token revokes the whole family (RFC 9700 §4.14.2)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedToken({ replacedById: 'rt-old-successor' }),
      );

      await expectRpcError(service.rotateRefreshToken('replayed-token'), 401);

      // The entire family gets revoked — the theft signal kills the session.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { familyId: 'family-1', revokedAt: null },
        }),
      );
      // No new token may be issued on a reuse attempt.
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects a revoked token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedToken({ revokedAt: new Date() }),
      );
      await expectRpcError(service.rotateRefreshToken('x'), 401);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expectRpcError(service.rotateRefreshToken('x'), 401);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expectRpcError(service.rotateRefreshToken('ghost'), 401);
    });
  });

  describe('revokeByPresentedToken (logout)', () => {
    it('revokes the family of the presented token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(storedToken());

      await service.revokeByPresentedToken('token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { familyId: 'family-1', revokedAt: null } }),
      );
    });

    it('is idempotent: unknown tokens do not fail and do not leak existence', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.revokeByPresentedToken('ghost')).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});

/** Asserts that a promise rejects with an RpcException carrying a statusCode. */
async function expectRpcError(
  promise: Promise<unknown>,
  statusCode: number,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected the promise to reject with an RpcException');
  } catch (error) {
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toMatchObject({ statusCode });
  }
}
