import net from 'node:net';
import { writeFileSync } from 'node:fs';

const pidFile = process.argv.find((argument) => argument.startsWith('--pid-file='));
if (pidFile !== undefined) writeFileSync(pidFile.slice('--pid-file='.length), String(process.pid));

const actions = ['tap', 'fill', 'clear', 'focus', 'press', 'check', 'uncheck', 'selectOption', 'hover'];
let value = '';
let status = 'Ready';
let focused = false;
const node = (id, role, name, fields = {}) => ({ ref: { id, revision: '' }, role, name, ...fields });
const snapshot = () => ({
  truncated: process.argv.includes('--truncated'),
  location: 'Mock native application', viewport: { width: 500, height: 400 },
  root: node('root', 'window', 'Mock native application', { children: [
    node('name', 'textbox', 'Name', { testId: 'name', value, rect: { x: 0, y: 0, width: 100, height: 30 } }),
    node('submit', 'button', 'Greet', { testId: 'submit', rect: { x: 0, y: 40, width: 100, height: 30 } }),
    ...(process.argv.includes('--truncated') ? [] : [node('status', 'status', status, { text: status, testId: 'status' })]),
    ...(process.argv.includes('--secure-leak') ? [node('password', 'textbox', 'Password', { states: { secure: true }, value: 'must-not-escape' })] : []),
  ] }),
});
const server = net.createServer((socket) => {
  let authenticated = false;
  let buffer = '';
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) break;
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      const request = JSON.parse(raw);
      const { id, method, params } = request;
      const reply = (result) => socket.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      const error = (code) => socket.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: code, data: { code } } }) + '\n');
      if (method === 'initialize') {
        if (params.token !== process.env.E2E_NATIVE_TOKEN || params.protocolVersion !== 1) { error('ENGINE_FAILURE'); socket.end(); continue; }
        authenticated = true;
        reply({ protocolVersion: 1, name: 'mock-helper', version: '1.0.0', actions: process.argv.includes('--missing-action') ? ['tap'] : actions, keyboard: true, screenshots: false });
      } else if (!authenticated) { error('ENGINE_FAILURE'); socket.end(); }
      else if (method === 'snapshot') reply(snapshot());
      else if (method === 'perform') {
        if (process.argv.includes('--exit-on-perform')) { process.exit(22); }
        if (process.argv.includes('--disconnect-perform')) { socket.destroy(); continue; }
        if (!['name', 'submit', 'status'].includes(params.ref.id)) { error('NODE_STALE'); continue; }
        if (params.action.kind === 'fill' && params.ref.id === 'name') { value = params.action.value; focused = true; }
        else if (params.action.kind === 'focus' && params.ref.id === 'name') focused = true;
        else if (params.action.kind === 'tap' && params.ref.id === 'submit') status = process.argv.includes('--bug') ? 'Wrong greeting' : `Hello ${value}`;
        else if (params.action.kind === 'clear' && params.ref.id === 'name') value = '';
        else { error('UNSUPPORTED_CAPABILITY'); continue; }
        if (process.argv.includes('--extra-reply')) {
          socket.write(JSON.stringify({ jsonrpc: '2.0', id, result: null }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: id + 1000, result: null }) + '\n');
        } else reply(null);
      } else if (method === 'keyboard.type') {
        if (!focused) { error('NOT_ACTIONABLE'); continue; }
        value = params.replace ? params.text : value + params.text;
        reply(null);
      } else if (method === 'keyboard.press') reply(null);
      else if (method === 'shutdown') {
        socket.write(JSON.stringify({ jsonrpc: '2.0', id, result: null }) + '\n', () => { server.close(); process.exit(0); });
      } else error('UNSUPPORTED_CAPABILITY');
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  if (process.argv.includes('--log-long-lines')) {
    const line = 'x'.repeat(4088) + 'STRADDLING-CREDENTIAL-DO-NOT-LEAK' + '\n';
    process.stdout.write(line);
    process.stderr.write(line);
  }
  if (!process.argv.includes('--no-ready')) process.stdout.write(`E2E_NATIVE_READY ${JSON.stringify({ port: server.address().port })}\n`);
});
