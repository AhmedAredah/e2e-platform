import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import net from 'node:net';

const separator = process.argv.indexOf('--');
if (separator < 0 || separator === process.argv.length - 1) process.exit(2);
const args = process.argv.slice(2, separator);
const record = args.find((arg) => arg.startsWith('--record='))?.slice('--record='.length);
const appCommand = process.argv[separator + 1];
const appArgs = process.argv.slice(separator + 2);
const { E2E_NATIVE_TOKEN: token, E2E_NATIVE_PORT: _port, ...appEnv } = process.env;
const app = spawn(appCommand, appArgs, { env: appEnv, stdio: 'ignore', shell: false });
app.once('error', () => process.exit(3));
const exited = new Promise((resolve) => app.once('exit', resolve));
if (record) writeFileSync(record, JSON.stringify({ sidecarPid: process.pid, appPid: app.pid, command: appCommand, args: appArgs, cwd: process.cwd(), tokenPresent: /^[a-f0-9]{64}$/.test(token ?? '') }));
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  app.kill();
  const timer = setTimeout(() => app.kill('SIGKILL'), 100);
  await exited;
  clearTimeout(timer);
  process.exit(code);
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
app.once('exit', () => { if (!stopping) process.exit(4); });
const server = net.createServer((socket) => {
  let authenticated = false;
  let buffer = '';
  socket.on('error', () => {});
  socket.on('close', () => { void stop(); });
  socket.on('data', (bytes) => {
    buffer += bytes.toString('utf8');
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      const frame = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const reply = (result) => socket.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n');
      if (frame.method === 'initialize' && frame.params.token === token && frame.params.protocolVersion === 1) {
        authenticated = true;
        reply({ protocolVersion: 1, name: 'mock-desktop', version: '1', actions: args.includes('--missing-action') ? ['tap'] : ['tap', 'fill', 'clear', 'focus', 'check', 'uncheck', 'selectOption'], keyboard: false, screenshots: false });
      } else if (!authenticated) { socket.destroy(); }
      else if (frame.method === 'snapshot') reply({ root: { ref: { id: 'root', revision: '' }, role: 'application', name: 'Mock desktop' }, viewport: { width: 1, height: 1 } });
      else if (frame.method === 'shutdown') { reply(null); void stop(); }
      else reply(null);
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  if (!args.includes('--no-ready')) process.stdout.write(`E2E_NATIVE_READY ${JSON.stringify({ port: server.address().port })}\n`);
});
