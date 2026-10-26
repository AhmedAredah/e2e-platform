# @e2e-cpp/github

> Fork installation: these package names are local release identities. Use the
> checksummed kit in [INSTALL_CPP.md](../../INSTALL_CPP.md), or pack the needed
> workspace module locally. Registry availability is not established.

The GitHub reporter for [`@e2e-cpp/core`](../e2e/README.md).
From GitHub Actions, every run becomes one pull request comment, edited in
place on reruns, and the same text lands in the job summary.

After building the source repository, pack this optional module with
`pnpm --filter @e2e-cpp/github pack --pack-destination /absolute/path/to/tarballs`.
Replace the paths below with your local tarballs; the core comes from the release kit.

```bash
npm install --save-dev /path/to/e2e-cpp-github-0.1.0.tgz
```

```ts title="e2e.config.ts"
import type { E2EConfig } from '@e2e-cpp/core';
import { playwright } from '@e2e-cpp/playwright';
import { github } from '@e2e-cpp/github';

export default {
  targets: [{ engine: playwright({ url: 'http://localhost:3000' }) }],
  reporters: ['list', github()],
} satisfies E2EConfig;
```

The job needs `permissions: pull-requests: write` and the step that runs
`@e2e-cpp/core` needs `GITHUB_TOKEN: ${{ github.token }}` in its `env`. Matrix replicas
of one job pass a `key` so their comments stay apart. When the reporter cannot
post (another CI, a push, a fork's read-only token) it says why in one summary
row and never changes the run's exit code.

Full documentation lives at [e2e.tester.army/docs/github](https://e2e.tester.army/docs/github).

## License

MIT
