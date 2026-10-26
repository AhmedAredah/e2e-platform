import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], JSON.stringify({
  pid: process.pid,
  args: process.argv.slice(3),
  allowed: process.env.DESKTOP_TEST_ALLOWED,
  ambient: process.env.DESKTOP_TEST_AMBIENT,
  nativeToken: process.env.E2E_NATIVE_TOKEN,
  nativePort: process.env.E2E_NATIVE_PORT,
}));
setInterval(() => {}, 1000);
