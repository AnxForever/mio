# Full Route QA - 2026-06-28

Scope: `/console`, `/chat`, `/studio`, `/settings`, `/memories`, `/messages`, `/mood`, `/extensions`, `/analytics`, `/onboarding`, `/auth`.

Viewports:

- Desktop: `1440x900`
- Mobile: `390x844`

Method:

- Started the built Mio server with `MIO_PROVIDER=mock` and `MIO_RATE_LIMIT_MAX=1000`.
- Visited each target route through hash routing.
- Rendered `/auth` directly through `renderAuth()` because it is an unauthenticated boot surface, not a registered app-shell route.
- Captured document width, visible headings/text, browser `console.error`/warnings, page errors, failed requests, and HTTP responses `>= 400`.

## Summary

| Route | Desktop | Mobile | Notes |
| --- | --- | --- | --- |
| `/console` | Pass | Pass | Main console content renders with status/workspace panels. |
| `/chat` | Pass | Pass | Empty conversation state renders; composer remains visible. |
| `/studio` | Pass | Pass | Persona workspace renders active mod, mode controls, and soul preview. |
| `/settings` | Pass | Pass | Gender, workspace links, memory, proactive, and notification controls render. |
| `/memories` | Pass | Pass | Memory review list and filters render. |
| `/messages` | Pass | Pass | Messages overview renders compact desktop/mobile states. |
| `/mood` | Pass | Pass | Mood room renders relationship and mood chips. |
| `/extensions` | Pass | Pass | Skills/plugins/MCP planning panels render without fake toggles. |
| `/analytics` | Pass | Pass | Four analytics API groups load and observation cards render. |
| `/onboarding` | Pass | Pass | Initial setup step renders with stable first action. |
| `/auth` | Pass | Pass | Token form and server-address disclosure render independently. |

Recheck: after the design-system layer and workspace-config toggles were added, the same 22 route/viewport combinations were scanned again; all passed with no overflow, page errors, console errors, or failed client responses.

Native recovery recheck: `better-sqlite3` was rebuilt for Linux, the malformed `vector.db` was quarantined as `vector.db.corrupt-*`, and the vector index was rebuilt from bookmarks. Full E2E then passed without native load, SQLite corruption, or mock rerank fallback warnings.

## Findings

- Horizontal overflow: none found. For all scanned routes, `documentElement.scrollWidth <= clientWidth`.
- Browser console errors: none found.
- Page runtime errors: none found.
- Failed client requests: none found.
- HTTP `>= 400` responses from page activity: none found.
- Loading/empty states: `/chat` shows the intended empty conversation state; `/onboarding` and `/auth` show first-use surfaces. Analytics loaded live data in this scan, so its degraded state was not exercised here.

## Residual Risk

- Resolved after this pass: `better-sqlite3 ... invalid ELF header` was caused by a Windows native binding being used from Linux/WSL. The local dependency was rebuilt and `npm run doctor:native` now checks `better-sqlite3` plus `sqlite-vec`.
- Resolved after this pass: the existing `data/memory-bank/vector.db` failed SQLite integrity checks. The vector store now quarantines malformed DB files and rebuilds a fresh DB instead of repeatedly failing chat/status memory paths.
- This pass checks route rendering and obvious client failures. It does not deeply validate every form save path or authenticated deployment mode.

## Verification Commands

- `npm run build`
- `npm run test:e2e`
- `npm run doctor:native`
