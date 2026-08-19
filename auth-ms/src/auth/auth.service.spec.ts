import { RpcException } from '@nestjs/microservices';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
  };
  let tokens: {
    issueTokenPair: jest.Mock;
    rotateRefreshToken: jest.Mock;
    revokeByPresentedToken: jest.Mock;
  };

  const pair = { accessToken: 'access.jwt', refreshToken: 'opaque-refresh' };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
    };
    tokens = {
      issueTokenPair: jest.fn().mockResolvedValue(pair),
      rotateRefreshToken: jest.fn().mockResolvedValue(pair),
      revokeByPresentedToken: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokens as unknown as TokensService,
    );
  });

  describe('register', () => {
    it('hashes the password with bcrypt and never returns the hash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'user-1',
          email: data.email,
          passwordHash: data.passwordHash,
          createdAt: new Date(),
        } as User),
      );

      const result = await service.register({
        email: 'a@b.com',
        password: 'super-secret-1',
      });

      const createArg = prisma.user.create.mock.calls[0][0];
      // Real bcrypt hash format: $2b$10$...
      expect(createArg.data.passwordHash).toMatch(/^\$2b\$10\$/);
      expect(createArg.data.passwordHash).not.toBe('super-secret-1');
      await expect(
        bcrypt.compare('super-secret-1', createArg.data.passwordHash),
      ).resolves.toBe(true);

      expect(result).toEqual({ id: 'user-1', email: 'a@b.com' });
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('rejects a duplicate email with 409', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expectRpcError(
        service.register({ email: 'a@b.com', password: 'super-secret-1' }),
        409,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects invalid input with 400', async () => {
      await expectRpcError(
        service.register({ email: 'not-an-email', password: 'super-secret-1' }),
        400,
      );
      await expectRpcError(
        service.register({ email: 'a@b.com', password: 'short' }),
        400,
      );
    });
  });

  describe('login', () => {
    it('returns a token pair on valid credentials', async () => {
      const passwordHash = await bcrypt.hash('super-secret-1', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash,
      });

      const result = await service.login({
        email: 'a@b.com',
        password: 'super-secret-1',
      });

      expect(tokens.issueTokenPair).toHaveBeenCalled();
      expect(result.accessToken).toBe(pair.accessToken);
      expect(result.refreshToken).toBe(pair.refreshToken);
      expect(result.user).toEqual({ id: 'user-1', email: 'a@b.com' });
    });

    it('rejects a wrong password with 401 and issues nothing', async () => {
      const passwordHash = await bcrypt.hash('super-secret-1', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash,
      });

      await expectRpcError(
        service.login({ email: 'a@b.com', password: 'wrong-password' }),
        401,
      );
      expect(tokens.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects an unknown user with the SAME 401 (no email enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expectRpcError(
        service.login({ email: 'ghost@b.com', password: 'super-secret-1' }),
        401,
      );
    });
  });

  describe('refresh / logout', () => {
    it('delegates rotation to TokensService', async () => {
      const result = await service.refresh({ refreshToken: 'token' });
      expect(tokens.rotateRefreshToken).toHaveBeenCalledWith('token');
      expect(result).toEqual(pair);
    });

    it('requires a refreshToken (400)', async () => {
      await expectRpcError(service.refresh({ refreshToken: '' }), 400);
      await expectRpcError(service.logout({ refreshToken: '' }), 400);
    });

    it('logout revokes the session family', async () => {
      await expect(service.logout({ refreshToken: 'token' })).resolves.toEqual({
        success: true,
      });
      expect(tokens.revokeByPresentedToken).toHaveBeenCalledWith('token');
    });
  });
});

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
