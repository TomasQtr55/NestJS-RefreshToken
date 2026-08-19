# auth-token-lifecycle Specification (delta)

## Purpose

Defines how the system registers users, validates credentials, issues token pairs, rotates refresh tokens, detects token theft, and revokes sessions. Owned entirely by `auth-ms`.

## ADDED Requirements

### Requirement: User registration
The system SHALL register a user with a unique email and a bcrypt-hashed password, and SHALL never expose the password hash in any response.

#### Scenario: Successful registration
- **GIVEN** no user exists with email `a@b.com`
- **WHEN** register is called with email `a@b.com` and a valid password
- **THEN** the user is persisted with a bcrypt hash (not the plaintext password)
- **AND** the response contains the user id and email, and NOT the password hash

#### Scenario: Duplicate email
- **GIVEN** a user already exists with email `a@b.com`
- **WHEN** register is called with the same email
- **THEN** the operation is rejected with a conflict error

### Requirement: Login issues a token pair
On valid credentials the system SHALL issue: (a) an HS256 JWT access token expiring in 15 minutes carrying the user id (`sub`) and email, and (b) an opaque, cryptographically random refresh token expiring in 7 days, bound to a NEW token family.

#### Scenario: Valid credentials
- **WHEN** login is called with correct email and password
- **THEN** an access token (JWT, 15 min) and a refresh token (opaque, 7 days) are returned
- **AND** the refresh token is persisted as a SHA-256 hash under a new `familyId`

#### Scenario: Wrong password
- **WHEN** login is called with an incorrect password
- **THEN** the operation is rejected with an unauthorized error and no tokens are persisted

### Requirement: Hash-only refresh token storage
The system SHALL store only the SHA-256 hash of each refresh token. The plaintext token SHALL never be persisted or logged.

#### Scenario: Database leak resistance
- **WHEN** a refresh token is issued
- **THEN** the stored record contains `sha256(token)` in `tokenHash`
- **AND** the plaintext token value appears nowhere in the database

### Requirement: Refresh rotation
Every successful refresh SHALL invalidate the presented token and issue a new token pair within the SAME family, recording which token replaced the old one (`replacedById`), per RFC 9700 §4.14.2.

#### Scenario: Happy-path rotation
- **GIVEN** a valid, unexpired, non-revoked refresh token R1 of family F
- **WHEN** refresh is called with R1
- **THEN** R1 is marked replaced by the new token R2 (same `familyId` F)
- **AND** a new access token and R2 are returned

### Requirement: Reuse detection revokes the family
If an already-rotated (replaced) refresh token is presented, the system SHALL treat it as potential theft: it SHALL revoke the entire token family and reject the request, per RFC 9700 §4.14.2.

#### Scenario: Rotated token replayed
- **GIVEN** refresh token R1 was already rotated into R2 (family F)
- **WHEN** refresh is called with R1
- **THEN** every token of family F is marked revoked
- **AND** the request is rejected with an unauthorized error
- **AND** subsequent use of R2 is also rejected

### Requirement: Invalid refresh tokens are rejected
The system SHALL reject with an unauthorized error any refresh token that is unknown, expired, or revoked.

#### Scenario: Expired token
- **GIVEN** a refresh token whose `expiresAt` is in the past
- **WHEN** refresh is called with it
- **THEN** the request is rejected with an unauthorized error

#### Scenario: Unknown token
- **WHEN** refresh is called with a token whose hash is not in the database
- **THEN** the request is rejected with an unauthorized error

### Requirement: Logout revokes the session
On logout the system SHALL revoke every active refresh token of the presented token's family.

#### Scenario: Logout
- **GIVEN** a valid refresh token of family F
- **WHEN** logout is called with it
- **THEN** all non-revoked tokens of family F are marked revoked
- **AND** refreshing with any of them afterwards fails
