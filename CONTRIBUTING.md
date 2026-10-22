# Contributing

Start with an issue for a reproducible bug or a proposed feature. For a bug,
include version, platform/browser, exact configuration and reproduction steps.
The issue template describes the optional local support bundle.

Do not upload purchased models, derived previews or original manuals to issues,
commits or pull requests. Use synthetic geometry for a reproducible test. Review
screenshots and diagnostic filenames before publishing them.

## Local checks

Use Python 3.12 and Node.js 22 or newer. Install the pinned importer requirements
inside a virtual environment, run the Python suite, then run `npm ci`,
`npm run check` and `npm test`. See README.md for exact commands.

Keep originals read-only. Preserve per-file identities and complete-STL quantities
through imports, saved designs and export packages. Missing data must stay
unknown: do not replace a missing model or weight with a convenient sample/zero.

Validate display changes with the relevant geometry and browser checks. State
when WebGL, native Windows packaging or real source geometry could not be tested.

An application code license has not yet been selected. Discuss substantial code
contributions in an issue before submitting them. Third-party notices must remain.
