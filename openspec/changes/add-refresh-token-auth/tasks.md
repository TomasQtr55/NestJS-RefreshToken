# Tasks

## 1. Infrastructure
- [x] 1.1 Write `.env.example` for `auth-ms` and `gateway` (documented vars)
- [x] 1.2 Install `auth-ms` deps: `@nestjs/microservices @nestjs/jwt @nestjs/config @prisma/client bcrypt dotenv` + dev `prisma @types/bcrypt`
- [x] 1.3 Install `gateway` deps: `@nestjs/microservices @nestjs/jwt @nestjs/config dotenv`
- [x] 1.4 Create Prisma schema and run first migration against local PostgreSQL

## 2. auth-ms
- [x] 2.1 `PrismaModule` + `PrismaService` (global)
- [x] 2.2 `TokensService`: access JWT signing, opaque refresh generation, SHA-256 hashing, rotation, reuse detection — with pedagogical comments (RFC 9700 §4.14.2)
- [x] 2.3 `AuthService`: register / login / refresh / logout
- [x] 2.4 `AuthController` with `@MessagePattern` handlers + `RpcException` error contract
- [x] 2.5 `main.ts` → `createMicroservice` TCP (no HTTP)
- [x] 2.6 Unit tests: `TokensService` and `AuthService` with mocked Prisma — **19/19 green**

## 3. gateway
- [x] 3.1 `ClientsModule` TCP registration toward `auth-ms`
- [x] 3.2 `AuthController` HTTP endpoints + error translation (409/401/400/503)
- [x] 3.3 `JwtAuthGuard` local verification + comment on stateless scaling
- [x] 3.4 Protected `GET /users/me`
- [x] 3.5 Unit tests: guard (valid/expired/forged/missing) and controller error mapping — **10/10 green**

## 4. Verification
- [x] 4.1 `npm test` green in both services (29/29) + `nest build` clean in both
- [x] 4.2 E2E flow verified end-to-end (11/11) + script delivered as `scripts/e2e-flow.ps1`
