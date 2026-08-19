# api-access-control Specification (delta)

## Purpose

Defines how the gateway protects HTTP routes using access tokens, and how it proxies authentication requests to `auth-ms`.

## ADDED Requirements

### Requirement: Local access token verification
The gateway SHALL verify access tokens locally (signature + expiration) using the shared JWT secret, WITHOUT calling `auth-ms` per request. This stateless verification is what allows the architecture to scale.

#### Scenario: Valid token
- **GIVEN** a request to a protected route with a valid, unexpired Bearer token
- **WHEN** the guard runs
- **THEN** access is granted and the request is enriched with the token payload (user id, email)

#### Scenario: Expired token
- **GIVEN** a request with an expired Bearer token
- **THEN** the request is rejected with HTTP 401

#### Scenario: Forged signature
- **GIVEN** a request with a token signed with a different secret
- **THEN** the request is rejected with HTTP 401

#### Scenario: Missing token
- **GIVEN** a request with no `Authorization` header
- **THEN** the request is rejected with HTTP 401

### Requirement: Auth proxying with error translation
The gateway SHALL expose `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, and `POST /auth/logout`, forwarding each to `auth-ms` over TCP and translating microservice errors into the correct HTTP status codes (409 conflict, 401 unauthorized, 400 bad request).

#### Scenario: proxied login failure
- **GIVEN** login credentials rejected by `auth-ms`
- **WHEN** `POST /auth/login` is called
- **THEN** the gateway responds HTTP 401 (not a 500)

#### Scenario: microservice unreachable
- **GIVEN** `auth-ms` is down
- **WHEN** any `/auth/*` endpoint is called
- **THEN** the gateway responds HTTP 503 with a clear error body
