# Contributing

Use Node.js 24 or newer. The project has no third-party runtime dependencies.

```sh
npm run check
npm test
npm run smoke
```

The test suite and clean-install smoke use synthetic fixtures. They must not require a model login, read real personal history, alter the original workstation database or call an external model service. Put live model checks in explicit opt-in scripts and document quota use.

Keep changes scoped and preserve the separation between source evidence, user feedback, current authorization and model-generated suggestions. A task must not become done just because its executor says it finished.

Never commit `data/`, `artifacts/`, `.protocol/`, authentication material, personal screenshots or raw chat/mail exports. Before pushing:

```sh
git add <public-source-files>
npm run audit:public
git diff --cached
```

For pull requests, describe the concrete behavior change, the checks performed and any compatibility limits. Open a small issue with a redacted reproducer when the intended behavior is uncertain.
