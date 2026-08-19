# Proposal: Refresh Token Authentication with Microservices

## Intent

University deliverable demonstrating a production-grade token lifecycle across two NestJS services. Today both services are empty starters with no authentication at all. We implement the current industry standard (RFC 9700 §2.2.2, §4.14.2): short-lived JWT access tokens plus long-lived opaque refresh tokens with rotation, reuse detection, and database-backed revocation.

## Scope

### In Scope
- `auth-ms`: pure TCP microservice owning users and refresh tokens (register, login, refresh, logout)
- `gateway`: public HTTP API delegating auth to `auth-ms`, local JWT guard, one protected route (`GET /users/me`)
- Prisma + PostgreSQL persistence: `User`, `RefreshToken` (hash-only storage, token families)
- Refresh token rotation with reuse detection → family revocation
- Pedagogical code comments at security-relevant points
- Unit tests (Jest, mocked Prisma) + e2e usage examples (curl/Postman)

### Out of Scope
- Docker, message brokers (Redis/NATS/RabbitMQ)
- RS256 key pairs, JWKS endpoints
- Email verification, password reset, roles/permissions
- Rate limiting, account lockout

## Capabilities

### New Capabilities
- `auth-token-lifecycle`: credential validation, token pair issuance, refresh rotation, reuse detection, family revocation
- `api-access-control`: gateway-side access token verification and route protection

### Modified Capabilities
None (greenfield).

## Approach

`auth-ms` runs as a pure TCP microservice (`@nestjs/microservices`), unreachable over HTTP. `gateway` exposes REST and forwards commands via `ClientProxy` message patterns. Access tokens are HS256 JWTs (15 min) verified locally by the gateway with the shared secret. Refresh tokens are cryptographically random opaque strings (7 days), stored as SHA-256 hashes only, rotated on every use within a token family; presenting an already-rotated token revokes the whole family (RFC 9700 §4.14.2).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `auth-ms/prisma/` | New | Schema + migration for `User` and `RefreshToken` |
| `auth-ms/src/prisma/` | New | PrismaService/PrismaModule |
| `auth-ms/src/auth/` | New | Message-pattern controller, AuthService, TokensService |
| `gateway/src/auth/` | New | HTTP controller, ClientProxy registration, JwtAuthGuard |
| `openspec/` | New | SDD artifacts (this change) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| JWT secret drift between services | Med | Single documented var, `.env.example`, comment in guard |
| Refresh token stored in plaintext | Low | SHA-256 hash only; test asserts lookup by hash |
| Rotation double-submit race | Low | Already-rotated token treated as theft → family revoked |

## Rollback Plan

Greenfield change: remove the new modules and `openspec/` folder; `npx prisma migrate reset` drops the tables. No pre-existing behavior is modified.

## Dependencies

- Local PostgreSQL running with database `auth_db` created; env vars per `.env.example`

## Success Criteria

- [ ] register → login → refresh → logout works end to end
- [ ] Reusing a rotated refresh token returns 401 and revokes the family (proven by test)
- [ ] Expired/invalid tokens rejected at both layers
- [ ] `npm test` green in both services
