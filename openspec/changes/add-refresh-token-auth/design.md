# Design: Refresh Token Authentication with Microservices

## Context

Two empty NestJS 11 starters (`auth-ms`, `gateway`), one local PostgreSQL. Goal: a university-grade implementation of the modern refresh token pattern, demonstrating microservice boundaries, token rotation, and revocation.

## Decisions

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| D1 | Inter-service transport | Native TCP (`@nestjs/microservices`) | Redis/NATS/RabbitMQ broker | Zero extra infrastructure; still demonstrates message patterns and ClientProxy. Brokers add ops complexity irrelevant to the learning goal. |
| D2 | Refresh token format | Opaque random string, SHA-256 hash stored | Refresh token as JWT | Opaque + DB enables real revocation and reuse detection (RFC 9700 §4.14.2). A JWT refresh token is stateless and cannot be revoked server-side. Hash-only storage makes DB leaks useless to an attacker. |
| D3 | Rotation strategy | Rotate every refresh; reuse → revoke family | Reuse window / grace period | RFC 9700 §4.14.2 recommended behavior; family revocation is the theft signal. A grace window weakens detection. |
| D4 | Access token | HS256 JWT, 15 min, verified locally by gateway | RS256 asymmetric; token introspection per request | HS256 shared secret is enough at this scale; gateway never gains signing capability concerns worth RS256 here (documented tradeoff). Local verification avoids a network hop per request — the whole point of JWTs in microservices. Introspection would couple gateway availability to auth-ms. |
| D5 | auth-ms exposure | Pure microservice, no HTTP listener | Hybrid HTTP+TCP | Nothing external can reach auth-ms; the gateway is the single entry point. |
| D6 | Config | `@nestjs/config`, validated, injected | Raw `process.env` scattered | Testable, explicit dependencies; secrets documented via `.env.example`. |
| D7 | Password hashing | bcrypt (cost 10) | argon2 | Faculty-standard, native-free install on Windows; noted as upgrade path. |

## Data model (Prisma)

```prisma
model User {
  id            String         @id @default(uuid())
  email         String         @unique
  passwordHash  String
  createdAt     DateTime       @default(now())
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id           String    @id @default(uuid())
  tokenHash    String    @unique        // sha256(token) — plaintext never stored
  familyId     String                   // groups one rotation chain = one session
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt    DateTime                 // now + 7 days at creation
  revokedAt    DateTime?                // set on logout or theft detection
  replacedById String?                  // set when rotated: id of the successor token
  createdAt    DateTime @default(now())

  @@index([familyId])
  @@index([userId])
}
```

## Message patterns (gateway → auth-ms over TCP)

| Pattern | Payload | Returns |
|---------|---------|---------|
| `auth.register` | `{ email, password }` | `{ id, email }` |
| `auth.login` | `{ email, password }` | `{ accessToken, refreshToken }` |
| `auth.refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| `auth.logout` | `{ refreshToken }` | `{ success: true }` |

## Core flows

**Login**: validate bcrypt → sign JWT (15m, `sub`, `email`) → generate 48-byte random refresh token → store `sha256(token)` with new `familyId` (uuid) → return pair.

**Refresh (rotation)**: hash presented token → look up by hash → reject if unknown / expired / revoked → **if `replacedById` is set: reuse detected → `UPDATE ... SET revokedAt = now() WHERE familyId = ? AND revokedAt IS NULL` → reject 401** → else mark replaced by new token, issue new pair, same `familyId`.

**Logout**: hash presented token → revoke all active tokens of its family.

**Guard (gateway)**: extract Bearer → `JwtService.verify` (shared secret, local) → attach payload to `request.user` → 401 on missing/expired/forged.

## Error contract

`auth-ms` throws `RpcException` with `{ statusCode, message }`; gateway catches and maps: 409 → Conflict, 401 → Unauthorized, 400 → Bad Request, connection failure → 503 Service Unavailable.

## Security notes (defense talking points)

- Refresh tokens are bearer secrets: stored hashed (like passwords), rotated every use, theft-detecting.
- Access tokens are intentionally unrevocable; 15-minute TTL bounds the blast radius.
- The gateway holds NO database access and NO refresh logic — compromise blast radius is minimized by design.
- Production upgrades (out of scope): RS256 + JWKS, DPoP sender-constraining, per-device user-agent binding, refresh on password change (schema already supports mass revocation by `userId`).

## Testing strategy

- `auth-ms` unit: `TokensService` + `AuthService` with mocked `PrismaService` — rotation, reuse detection, expiry, wrong password, hash-only storage.
- `gateway` unit: `JwtAuthGuard` (valid/expired/forged/missing) with real `JwtService`; controller error translation with mocked `ClientProxy`.
- Manual e2e: documented curl sequence for the full flow including the theft scenario.
