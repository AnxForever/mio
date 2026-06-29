# ADR-0002: Localhost-First Security Model

Status: Proposed

Date: 2026-06-28

## Context

Mio is designed as a private local companion agent. The server defaults to localhost, and authentication is optional. This fits local personal use but should not be confused with an internet-hardened deployment.

Architecture research found strong privacy primitives: IM session isolation, Zod validation, upload MIME/size checks, tool restrictions, safe frontend DOM construction, OpenAI bearer auth envelopes, and rate limiting. It also found risks: optional auth, public read/setup routes, frontend token storage in `localStorage`, frontend auth checks through public `/status`, and missing native-route auth tests.

## Decision

Mio's security model should be documented as localhost-first.

Binding to non-localhost interfaces must require an explicit auth token and deployment guidance. Public read/setup routes should be reviewed under that deployment mode.

## Rationale

- The product's strongest privacy property is local operation, not remote hardening.
- Optional auth is acceptable for `127.0.0.1` personal use.
- External binding changes the threat model and should not inherit local defaults silently.

## Consequences

Positive:

- Keeps local usage simple.
- Makes the security boundary honest and auditable.
- Avoids overclaiming privacy posture.

Negative:

- Some API clients may need token setup for remote/mobile access.
- Public status/onboarding/admin-log style routes need explicit classification.
- Frontend token handling needs a stricter validation path.

## Evidence

- Server defaults to `127.0.0.1` according to architecture research.
- `src/server/auth.ts` allows requests when no token is configured.
- `/status` is public and is used by frontend auth checks.
- Tests strongly cover OpenAI-compatible auth but native route auth has gaps.
- Frontend stores bearer token in `localStorage`.

## Follow-Ups

- Add native auth tests for `/chat`, `/admin/export`, `/mods/:name/soul`, `/notify/test`, `/memories`, and WS `?token=`.
- Add a dedicated authenticated health/auth check endpoint or change frontend login validation.
- Document "non-localhost binding requires `MIO_AUTH_TOKEN`."
- Review unauthenticated onboarding behavior for non-localhost use.
