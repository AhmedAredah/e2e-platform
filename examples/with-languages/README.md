# Real Python, C# and Rust CLI/HTTP fixtures

This private example package runs the same TypeScript test suite against three
actual applications. See [LANGUAGES.md](../../LANGUAGES.md) for the public launch
profiles, support boundaries and verification procedure.

- `apps/python/calculator/`: abstract arithmetic operation, composed calculator,
  application controller and standard-library loopback HTTP adapter.
- `apps/dotnet/Domain/`: abstract operation and calculator interface, consumed by a
  console entry point and ASP.NET Core/Kestrel application controller.
- `apps/rust/src/`: operation traits, calculator composition and a small bounded
  loopback HTTP transport.
- `support/`: shared runtime profiles, bounded service readiness/teardown and an
  independent numeric oracle.
- `tests/`: positive contracts and planted wrong-output cases.
- `build/` and `.e2e/`: generated outputs and evidence; not source files.

The scoped ignore file also excludes .NET `bin`/`obj`, Cargo `target`, and
Python bytecode/cache directories so restore and execution artifacts stay out
of the source archive.

From the repository root, after installing workspace dependencies and toolchains:

```sh
pnpm build:cpp
node scripts/languages/verify.mjs
```

All three languages are mandatory. The verifier builds first, then requires nine
positive results and six specifically identified assertion failures with complete
cleanup. It writes `.e2e/languages/verification.json` only after everything succeeds.
Missing compilers and runtimes are failures, not skips.

For individual development runs, build with `node scripts/languages/build.mjs`,
then run `pnpm --filter e2e-example-with-languages test:e2e`. The
`test:e2e:negative` command deliberately exits 1; the full verifier checks that this
is caused by wrong arithmetic rather than infrastructure failure.

Each app accepts `sum <a> <b>` or `serve`. `serve` binds only `127.0.0.1` on an
OS-assigned ephemeral port and emits one `E2E_LANGUAGE_READY {"port":...}` line.
`GET /health` reports availability; `GET /sum?a=0.1&b=0.2` returns JSON. The shared
fixture limits readiness to 5 seconds, requests to 2 seconds, output to 64 KiB and
service lifetime to 15 seconds, and stops the owned process even when an assertion
fails. No preselected port or arbitrary sleep is needed.

`--wrong-result` intentionally offsets the sum by one. It must remain detectable.
Tests are authored in TypeScript; this example includes no Python/.NET/Rust test
SDK and no GUI automation adapter.
