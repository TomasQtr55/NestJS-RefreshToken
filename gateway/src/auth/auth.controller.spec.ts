import { HttpException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { AuthController } from './auth.controller';

/**
 * The ClientProxy is mocked: these tests prove the gateway's error
 * TRANSLATION contract (RPC error → HTTP status), not auth-ms itself.
 */
describe('AuthController', () => {
  let client: { send: jest.Mock };
  let controller: AuthController;

  beforeEach(() => {
    client = { send: jest.fn() };
    controller = new AuthController(client as unknown as ClientProxy);
  });

  it('forwards login to auth-ms and returns its response', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r' };
    client.send.mockReturnValue(of(tokens));

    const body = { email: 'a@b.com', password: 'super-secret-1' };
    await expect(controller.login(body)).resolves.toEqual(tokens);
    expect(client.send).toHaveBeenCalledWith('auth.login', body);
  });

  it('maps every endpoint to its message pattern', () => {
    client.send.mockReturnValue(of({}));
    controller.register({});
    controller.refresh({});
    controller.logout({});
    expect(client.send).toHaveBeenNthCalledWith(1, 'auth.register', {});
    expect(client.send).toHaveBeenNthCalledWith(2, 'auth.refresh', {});
    expect(client.send).toHaveBeenNthCalledWith(3, 'auth.logout', {});
  });

  it('translates an RPC 401 into an HTTP 401 (not a 500)', async () => {
    client.send.mockReturnValue(
      throwError(() => ({ statusCode: 401, message: 'Invalid credentials' })),
    );

    await expect(controller.login({})).rejects.toMatchObject({
      message: 'Invalid credentials',
      status: 401,
    });
  });

  it('translates an RPC 409 (duplicate email) into an HTTP 409', async () => {
    client.send.mockReturnValue(
      throwError(() => ({ statusCode: 409, message: 'Email is already registered' })),
    );

    await expect(controller.register({})).rejects.toMatchObject({
      status: 409,
    });
  });

  it('answers 503 when auth-ms is unreachable (transport-level failure)', async () => {
    client.send.mockReturnValue(
      throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:3001')),
    );

    try {
      await controller.login({});
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).message).toBe(
        'Authentication service unavailable',
      );
    }
  });
});
