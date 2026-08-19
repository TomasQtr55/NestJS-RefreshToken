import { RpcException } from '@nestjs/microservices';

/**
 * Contrato de errores entre auth-ms y el gateway.
 *
 * En un microservicio TCP no existen los códigos HTTP, así que lanzamos
 * una RpcException con un objeto plano: { statusCode, message }.
 * El gateway lee `statusCode` y lo traduce de vuelta a HTTP
 * (409 Conflict, 401 Unauthorized, 400 Bad Request, ...).
 */
export function rpcError(statusCode: number, message: string): RpcException {
  return new RpcException({ statusCode, message });
}
