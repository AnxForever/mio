# Architecture Improvement RFC Pack

Purpose: define implementation-ready design proposals before modifying code.

These RFCs are intentionally research/design artifacts. They do not change `src/`, `web/`, `packages/`, tests, or build scripts.

## RFC Index

| RFC | Topic | Primary risk addressed | Status |
|---|---|---|---|
| [RFC-0001](0001-server-route-split.md) | Split `src/server/index.ts` by route family | Server route monolith, route-family security review difficulty | Proposed |
| [RFC-0002](0002-turn-context-providers.md) | Extract `agent-loop.ts` context providers | Core prompt/context concentration | Proposed |
| [RFC-0003](0003-package-drift-governance.md) | Govern app/package drift | `src/emotion` vs `packages/emotion`, `src/persona` vs `packages/idrag` divergence | Proposed |
| [RFC-0004](0004-remote-deployment-security-policy.md) | Remote deployment security policy | Localhost-first assumptions under LAN/public exposure | Proposed |

## Shared Rules

- Tests come first for the boundary being changed.
- Keep public behavior contracts stable unless a separate ADR/RFC explicitly changes them.
- Do not split a file only by line count; split by route family, domain ownership, or testable contract.
- Preserve Mio's local-first modular monolith shape. These RFCs do not propose microservices.
- Each RFC must define acceptance criteria that can be verified by command output, tests, route behavior, or import scans.

## Recommended Order

1. `RFC-0004`: security policy and auth tests, because route splitting touches auth boundaries.
2. `RFC-0001`: server route split, after native route auth tests exist.
3. `RFC-0002`: core context provider extraction, after ID-RAG and prompt-context tests exist.
4. `RFC-0003`: package drift governance, can run in parallel once parity tests are specified.

