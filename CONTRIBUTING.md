# Contributing

Thanks for helping. Contributions are accepted under the project license (FSL-1.1-ALv2, see `LICENSE`); by opening a
pull request you confirm you have the right to submit the code under it.

## Questions and bug reports

Use [GitHub Issues](https://github.com/fberkehan/orion/issues) for bug reports, questions and feature requests;
search the existing issues first. There is no other support channel. Security problems are the exception: report them
privately as described in `SECURITY.md`.

## Setup

```
npm ci
npm run typecheck
npm test
```

Node 24+ and Windows 11 are needed for the full app. Unit tests need no keys, network, GPU or devices; heavy
end-to-end and audio tests are not part of this repository.

## Guidelines

- Keep changes focused; add or update unit tests next to the code (`*.test.ts`, vitest).
- New modules go in `apps/desktop/src/main/modules/<id>/` (and a page in `renderer/main/pages/<id>/`, strings in
  `packages/shared/src/i18n/tr/<id>.ts`); they are discovered automatically. Run `npm run gen` if indexes look stale.
- The UI dictionary is Turkish today. Adding another locale is welcome but is a larger change; discuss it first.
- Never commit keys, personal data, recordings or model weights. Use synthetic examples in tests.
- Optional device integrations belong in `plugins/` and must not add dependencies to the core.
- Security issues: see `SECURITY.md`.
