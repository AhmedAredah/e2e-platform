// Portable wire-contract fixture. This is not a Windows Job Object implementation.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'normal';
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let child;
let stopped = false;
let closed = false;
let stopId;
let writes = Promise.resolve();

function send(event) {
  writes = writes.then(() => new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(event)}\n`, error => error ? reject(error) : resolve());
  }));
  return writes;
}

function output(stream, bytes) {
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    void send({ kind: 'output', stream, data: bytes.subarray(offset, offset + 16 * 1024).toString('base64') });
  }
}

input.on('line', line => {
  const request = JSON.parse(line);
  if (request.kind === 'launch') {
    if (mode === 'stall') return;
    if (mode === 'oversized') { process.stdout.write('x'.repeat(128 * 1024 + 1)); return; }
    if (mode === 'malformed') { process.stdout.write('{invalid}\n'); return; }
    if (mode === 'error') { void send({ kind: 'error', code: 'LAUNCH_FAILED', message: 'sensitive helper payload' }); input.close(); process.stdin.destroy(); return; }
    if (mode === 'abrupt') { process.stdout.end(); input.close(); process.stdin.destroy(); return; }
    if (mode === 'binary') {
      void send({ kind: 'started', id: 1, pid: process.pid + 1 });
      void send({ kind: 'output', stream: 'stdout', data: '%%%bad' });
      return;
    }
    child = spawn(request.executable, request.args, { cwd: request.cwd, env: request.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('spawn', () => { void send({ kind: 'started', id: 1, pid: child.pid }); });
    child.stdout.on('data', bytes => { output('stdout', bytes); });
    child.stderr.on('data', bytes => { output('stderr', bytes); });
    child.stdin.on('error', () => undefined);
    child.once('error', () => { void send({ kind: 'error', code: 'LAUNCH_FAILED', message: 'The owned process could not be started.' }); input.close(); process.stdin.destroy(); });
    child.once('exit', code => { void send({ kind: 'rootExit', exitCode: code ?? 0 }); });
    child.once('close', code => {
      closed = true;
      if (mode === 'unconfirmed') { input.close(); process.stdin.destroy(); return; }
      void send({ kind: 'exit', exitCode: mode === 'disagree' ? 123 : (code ?? 0), stopped, cleanup: true });
      if (stopId !== undefined) void send({ kind: 'ack', id: stopId });
      void writes.then(() => { input.close(); process.stdin.destroy(); process.stdout.end(); });
    });
  } else if (request.kind === 'stdin') {
    child?.stdin.write(Buffer.from(request.data, 'base64'), error => {
      if (!error) void send({ kind: 'ack', id: request.id });
    });
  } else if (request.kind === 'eof') {
    child?.stdin.end();
    if (mode !== 'lost-eof') void send({ kind: 'ack', id: request.id });
  } else if (request.kind === 'stop') {
    stopped = true;
    if (child === undefined) { input.close(); process.stdin.destroy(); return; }
    if (mode === 'ack-after-exit') stopId = request.id;
    else void send({ kind: 'ack', id: request.id });
    child.kill();
  }
});
input.on('close', () => { if (!closed) child?.kill(); });

