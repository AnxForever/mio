# Contributing to Mio

Thanks for contributing. Mio is a toolkit first, reference app second — contributions to either are welcome.

## Setup

```bash
git clone https://github.com/AnxForever/mio.git
cd mio && npm install
npm run build
npm test                 # 104 tests must pass
```

Node ≥ 22. No global installs needed beyond `node` and `npm`.

## Project Conventions

- **TypeScript strict mode** — `tsc --noEmit` must pass
- **ESM only** — `"type": "module"`, import paths end in `.js`
- **No `console.log`** — use `logger` from `src/utils/logger.ts` (REPL/onboarding exempt)
- **All disk paths via `src/memory/paths.ts`** — never inline `join()`
- **No new dependencies without discussion** — open an issue first
- **Tests required** for new emotion/memory/persona logic

Full conventions in [CLAUDE.md](CLAUDE.md).

## Before Submitting

```bash
npm run typecheck    # must pass
npm run build        # must pass
npm test             # must pass (104 tests)
```

## PR Process

1. Fork, branch from `main`
2. Make changes, add tests
3. Run the verification commands above
4. Open PR with a clear description
5. CI must be green

Small PRs preferred. Single-concern commits.

## Issues

- **Bug**: what happened, what you expected, Node version, steps to reproduce
- **Feature**: what problem it solves, suggested approach
- **Question**: ask in Discussions or in the issue

## License

By contributing, you agree your contributions will be licensed under MIT.
