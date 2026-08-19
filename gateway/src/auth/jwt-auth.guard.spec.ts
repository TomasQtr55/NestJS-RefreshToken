import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Guard tests use a REAL JwtService: we want to prove behavior against
 * genuine JWT semantics (expiration, signature), not against a mock.
 */
describe('JwtAuthGuard', () => {
  const SECRET = 'test-secret';
  let jwt: JwtService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwt = new JwtService({ secret: SECRET });
    guard = new JwtAuthGuard(jwt);
  });

  /** Builds a minimal ExecutionContext around a mutable request object. */
  function contextWith(headers: Record<string, string>) {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it('grants access to a valid token and attaches the payload to the request', async () => {
    const token = await jwt.signAsync({ sub: 'user-1', email: 'a@b.com' });
    const { context, request } = contextWith({
      authorization: `Bearer ${token}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ sub: 'user-1', email: 'a@b.com' });
  });

  it('rejects a request without Authorization header (401)', async () => {
    const { context } = contextWith({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a malformed Authorization header (401)', async () => {
    const { context } = contextWith({ authorization: 'Token abc' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an EXPIRED token with a specific message', async () => {
    // expiresIn < 0 → the token is born already expired.
    const expired = await jwt.signAsync(
      { sub: 'user-1', email: 'a@b.com' },
      { expiresIn: -10 },
    );
    const { context } = contextWith({ authorization: `Bearer ${expired}` });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Access token expired',
    );
  });

  it('rejects a token signed with a DIFFERENT secret (forgery)', async () => {
    const attackerJwt = new JwtService({ secret: 'attacker-secret' });
    const forged = await attackerJwt.signAsync({ sub: 'user-1' });
    const { context } = contextWith({ authorization: `Bearer ${forged}` });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid access token',
    );
  });
});
