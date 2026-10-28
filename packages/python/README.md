# @e2e-platform/python

Register Python/pytest cases with the shared E2E Platform runner:

```ts
import { registerPythonTests } from '@e2e-platform/python';
await registerPythonTests({
  interpreter: '/absolute/path/to/venv/bin/python',
  cwd: '/absolute/path/to/project',
  tests: ['python_tests'],
});
```

Install the matching `sdks/python` wheel into that interpreter and configure a
normal `e2e.config.ts` target. Run the locally installed `e2e-platform` CLI or
`python -m e2e_platform run --no-model`. The adapter requires Node and does not
start an independent pytest scheduler. Each case owns one Python process.

See the repository's [Python guide](https://github.com/AhmedAredah/e2e-platform/blob/main/PYTHON.md)
for installation, fixtures, plugins, lifecycle and supported engine capabilities.
Registry publication is not established; use the checksummed local installation kit.
