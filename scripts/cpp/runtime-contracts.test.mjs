import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

/** Tests plain Node and event-loop liveness outside Vitest's bundler and worker handles. */
function cold(code) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
  assert.equal(result.stdout.trim(), 'TIMEOUT');
}
const terminal = new URL('../../packages/terminal/dist/index.js', import.meta.url).href;
const protocol = new URL('../../packages/protocol/dist/index.js', import.meta.url).href;

test('packed-style terminal ESM import and pending deadline keep Node alive', () => {
  cold(`import { TerminalSession, TerminalTransport } from ${JSON.stringify(terminal)};
    class Hanging extends TerminalTransport {
      write() { return new Promise(() => {}); }
      resize() {} onData() { return () => {}; } onExit() { return () => {}; }
      async close() {}
    }
    const session = new TerminalSession(new Hanging());
    try { await session.write('x', { timeoutMs: 30 }); process.exitCode = 1; }
    catch (error) { console.log(error.code); }
    finally { await session.close(); }`);
});

test('HTTP deadline settles an awaited custom transport with no other Node handles', () => {
  cold(`import { HttpProtocolClient, HttpTransport } from ${JSON.stringify(protocol)};
    class Hanging extends HttpTransport {
      send(_url, request) { return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      }); }
    }
    try { await new HttpProtocolClient({ baseUrl: 'http://127.0.0.1', timeoutMs: 30 }, new Hanging()).get('/'); process.exitCode = 1; }
    catch (error) { console.log(error.code); }`);
});

test('engine versions follow the package metadata used for releases', () => {
  const native = new URL('../../packages/native/dist/index.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { TerminalEngine } from ${JSON.stringify(terminal)};
    import { native } from ${JSON.stringify(native)};
    assert.equal(new TerminalEngine().version, JSON.parse(readFileSync(new URL('../package.json', ${JSON.stringify(terminal)}))).version);
    assert.equal(native().version, JSON.parse(readFileSync(new URL('../package.json', ${JSON.stringify(native)}))).version);
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});
