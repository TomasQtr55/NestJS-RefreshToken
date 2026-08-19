# Verify Report: add-refresh-token-auth

## Summary

All 29 unit tests green (19 auth-ms + 10 gateway). Full e2e flow verified end-to-end against a running auth-ms + gateway + PostgreSQL stack: **11/11 scenarios passed**.

## Spec scenario mapping

### auth-token-lifecycle

| Spec scenario | Test evidence |
|---|---|
| Successful registration | auth-ms unit `auth.service.spec.ts` "hashes the password with bcrypt and never returns the hash"; e2e step 1 |
| Duplicate email | auth-ms unit `auth.service.spec.ts` "rejects a duplicate email with 409"; e2e step 2 |
| Valid credentials login | e2e step 4 (token pair returned) |
| Wrong password | auth-ms unit "rejects a wrong password with 401 and issues nothing"; e2e step 3 |
| Hash-only refresh token storage | auth-ms unit `tokens.service.spec.ts` "persists only the HASH of the refresh token, never the plaintext" |
| Happy-path rotation | e2e step 7 (new pair, different refresh token) |
| Rotated token replayed (reuse detection) | auth-ms unit "REUSE DETECTION: an already-rotated token revokes the whole family"; **e2e steps 8 + 9** (theft detected AND the new token also rejected, proving family revocation cascaded) |
| Expired / unknown / revoked token | auth-ms unit 3 cases; e2e step 11 (refresh after logout → 401) |
| Logout revokes session | e2e steps 10 + 11 |

### api-access-control

| Spec scenario | Test evidence |
|---|---|
| Valid token grants access | gateway unit `jwt-auth.guard.spec.ts`; e2e step 5 (payload attached to request) |
| Expired token | gateway unit "rejects an EXPIRED token with a specific message" |
| Forged signature | gateway unit "rejects a token signed with a DIFFERENT secret (forgery)" |
| Missing token | gateway unit + e2e step 6 |
| Proxied login failure → 401 | gateway unit `auth.controller.spec.ts` "translates an RPC 401 into an HTTP 401" |
| Microservice unreachable → 503 | gateway unit "answers 503 when auth-ms is unreachable" |

## Bug caught during verify

**JWT TTL string bug**: `config.get<number>('JWT_ACCESS_TTL', 900)` returned the string `"900"` (env vars are always strings), which jsonwebtoken parsed via the `ms` library as 900 **milliseconds** — tokens expired before the client could use them. Fixed with explicit `Number()` conversion in `auth-ms/src/auth/auth.module.ts` and a pedagogical comment. This is the exact kind of wiring bug that unit tests with hardcoded numeric values miss — the e2e flow caught it in step 5.

## E2E test script

`scripts/e2e-flow.ps1` (PowerShell) boots both services, runs the 11-step flow against the live stack, and shuts them down. Run with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\e2e-flow.ps1
```

Requires: both services built (`npm run build` in each), PostgreSQL running with `auth_db` accessible via `auth-ms/.env`.

## Idioma de los comentarios

Los comentarios pedagógicos del código están en español neutro/profesional. Los términos técnicos (JWT, hash, bcrypt, RFC, etc.) se mantienen en inglés — estándar en documentación técnica en español.

## Status

**VERIFIED** — implementation matches spec. Ready for delivery.
