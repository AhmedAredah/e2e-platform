import { createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcTcpTransport } from '../src/index.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).toReversed()) await close(); });
const context = (timeoutMs = 1000) => ({ signal: new AbortController().signal, timeoutMs });

async function bridge(handle: (request: { id: number; method: string }, socket: Socket) => void, limit = 4096) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    let buffered = '';
    socket.on('data', (bytes) => {
      buffered += bytes.toString();
      for (;;) {
        const newline = buffered.indexOf('\n');
        if (newline < 0) return;
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        handle(JSON.parse(line), socket);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  const transport = await JsonRpcTcpTransport.connect(address.port, context(), limit);
  cleanup.push(() => transport.close());
  return transport;
}

describe('authenticated-bridge transport mechanics', () => {
  it('reassembles fragmented responses and serializes queued requests', async () => {
    const ids: number[] = [];
    const transport = await bridge(({ id, method }, socket) => {
      ids.push(id);
      const response = JSON.stringify({ jsonrpc: '2.0', id, result: method }) + '\n';
      socket.write(response.slice(0, 9));
      setTimeout(() => socket.write(response.slice(9)), 10);
    });
    await expect(Promise.all([transport.request('first', {}, context()), transport.request('second', {}, context())])).resolves.toEqual(['first', 'second']);
    expect(ids).toEqual([1, 2]);
  });

  it('does not retry a mutation whose response timed out', async () => {
    let calls = 0;
    const transport = await bridge(() => { calls++; });
    await expect(transport.request('perform', {}, context(25), true)).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
    await expect(transport.request('perform', {}, context(), true)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    expect(calls).toBe(1);
  });

  it('distinguishes a read timeout from an uncertain mutation', async () => {
    const transport = await bridge(() => {});
    await expect(transport.request('snapshot', {}, context(25))).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
  });

  it('drains a timed-out read before sending a later mutation without reusing its reply', async () => {
    let reply!: () => void;
    const calls: string[] = [];
    const transport = await bridge(({ id, method }, socket) => {
      calls.push(method);
      if (method === 'snapshot') reply = () => socket.write(JSON.stringify({ jsonrpc: '2.0', id, result: 'old snapshot' }) + '\n');
      else socket.write(JSON.stringify({ jsonrpc: '2.0', id, result: 'mutation reply' }) + '\n');
    });
    await expect(transport.request('snapshot', {}, context(25))).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    const mutation = transport.request('perform', {}, context(), true);
    await Promise.resolve();
    expect(calls).toEqual(['snapshot']);
    reply();
    await expect(mutation).resolves.toBe('mutation reply');
    expect(calls).toEqual(['snapshot', 'perform']);
  });

  it('bounds queued requests while a timed-out read is draining and permits owned close', async () => {
    let calls = 0;
    const transport = await bridge(() => { calls++; });
    await expect(transport.request('snapshot', {}, context(25))).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(transport.request('perform', {}, context(25), true)).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    expect(calls).toBe(1);
    const queued = transport.request('shutdown', {}, context(), true);
    transport.close();
    await expect(queued).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    expect(calls).toBe(1);
  });

  it('still rejects a wrong late reply after a read deadline', async () => {
    let reply!: () => void;
    const transport = await bridge(({ id }, socket) => {
      reply = () => socket.write(JSON.stringify({ jsonrpc: '2.0', id: id + 1, result: null }) + '\n');
    });
    const disconnected = vi.fn();
    transport.onDisconnect(disconnected);
    await expect(transport.request('snapshot', {}, context(25))).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    reply();
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
    await expect(transport.request('snapshot', {}, context())).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
  });

  it.each([false, true])('does not expire an early timer callback before the request deadline (mutation: %s)', async (mutates) => {
    let received!: () => void;
    const dispatched = new Promise<void>((resolve) => { received = resolve; });
    let calls = 0;
    const transport = await bridge(() => { calls++; received(); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      let settled = false;
      const result = transport.request(mutates ? 'perform' : 'snapshot', {}, context(25), mutates)
        .then(() => { settled = true; return undefined; }, (error: unknown) => { settled = true; return error; });
      await dispatched;
      clock.mockReturnValue(1024);
      await vi.advanceTimersByTimeAsync(25);
      expect(settled).toBe(false);
      clock.mockReturnValue(1025);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ code: mutates ? 'ACTION_MAY_HAVE_COMMITTED' : 'OPERATION_TIMEOUT' });
      expect(calls).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clock.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not send an already cancelled request', async () => {
    let calls = 0;
    const transport = await bridge(() => { calls++; });
    const controller = new AbortController();
    controller.abort();
    await expect(transport.request('perform', {}, { signal: controller.signal, timeoutMs: 1000 }, true)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls).toBe(0);
  });

  it('rejects wrong response ids and bounded overflows', async () => {
    const transport = await bridge(({ id }, socket) => socket.write(JSON.stringify({ jsonrpc: '2.0', id: id + 1, result: null }) + '\n'));
    await expect(transport.request('snapshot', {}, context())).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    const overflow = await bridge((_request, socket) => socket.write('x'.repeat(2048)), 1024);
    await expect(overflow.request('snapshot', {}, context())).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
  });

  it('maps structured stale-node errors without leaking helper error messages', async () => {
    const transport = await bridge(({ id }, socket) => socket.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'private contents', data: { code: 'NODE_STALE' } } }) + '\n'));
    await expect(transport.request('perform', {}, context(), true)).rejects.toMatchObject({ code: 'NODE_STALE', retryable: true, message: 'native bridge NODE_STALE' });
  });

  it('rejects malformed UTF-8 without accepting a replacement character as source data', async () => {
    const transport = await bridge(({ id }, socket) => socket.write(Buffer.concat([
      Buffer.from(`{"jsonrpc":"2.0","id":${id},"result":"private-`),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}\n'),
    ])));
    const disconnected = vi.fn();
    transport.onDisconnect(disconnected);
    await expect(transport.request('snapshot', {}, context())).rejects.toMatchObject({ code: 'ENGINE_FAILURE', message: 'malformed or unexpected native response' });
    expect(disconnected).toHaveBeenCalledOnce();
    await expect(transport.request('snapshot', {}, context())).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
  });

  it.each(['-32000.5', '1e309'])('rejects invalid numeric error code %s before accepting retryable errors', async (code) => {
    const transport = await bridge(({ id }, socket) => socket.write(`{"jsonrpc":"2.0","id":${id},"error":{"code":${code},"message":"private","data":{"code":"NODE_STALE"}}}\n`));
    await expect(transport.request('perform', {}, context(), true)).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED', retryable: false });
  });

  it('decodes a valid Unicode scalar split across TCP chunks without data loss', async () => {
    const transport = await bridge(({ id }, socket) => {
      const prefix = Buffer.from(`{"jsonrpc":"2.0","id":${id},"result":"`);
      const value = Buffer.from('😀');
      socket.write(Buffer.concat([prefix, value.subarray(0, 2)]));
      setTimeout(() => socket.write(Buffer.concat([value.subarray(2), Buffer.from('"}\n')])), 10);
    });
    await expect(transport.request('snapshot', {}, context())).resolves.toBe('😀');
  });

  it('reports a protocol fault after a successful reply without repeating disconnect notifications', async () => {
    const transport = await bridge(({ id }, socket) => socket.write(
      JSON.stringify({ jsonrpc: '2.0', id, result: null }) + '\n'
      + JSON.stringify({ jsonrpc: '2.0', id: id + 1, result: null }) + '\n',
    ));
    const disconnected = vi.fn();
    transport.onDisconnect(disconnected);
    await expect(transport.request('perform', {}, context(), true)).resolves.toBeNull();
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
    await expect(transport.request('snapshot', {}, context())).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    transport.close();
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it('reports malformed data while idle but keeps an intentional close quiet', async () => {
    let peer: Socket | undefined;
    const transport = await bridge(({ id }, socket) => {
      peer = socket;
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, result: null }) + '\n');
    });
    const disconnected = vi.fn();
    transport.onDisconnect(disconnected);
    await transport.request('snapshot', {}, context());
    if (peer === undefined) throw new Error('no connected peer');
    peer.write('not JSON\n');
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
    const normal = await bridge(({ id }, socket) => socket.write(JSON.stringify({ jsonrpc: '2.0', id, result: null }) + '\n'));
    const intentionallyClosed = vi.fn();
    normal.onDisconnect(intentionallyClosed);
    normal.close();
    expect(intentionallyClosed).not.toHaveBeenCalled();
  });
});
