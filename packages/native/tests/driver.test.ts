import { expect, test } from 'vitest';
import { NativeTransport, RpcNativeDriver } from '../src/index.ts';

class MalformedTransport extends NativeTransport {
  async request(): Promise<unknown> { return { success: false, error: 'rejected' }; }
  close(): void {}
}

test('protocol mutations require null acknowledgement and preserve uncertainty', async () => {
  const driver = new RpcNativeDriver(new MalformedTransport());
  const context = { signal: new AbortController().signal, timeoutMs: 100 };
  for (const operation of [
    () => driver.perform({ id: 'button', revision: '' }, { kind: 'tap' }, context),
    () => driver.type('text', false, context),
    () => driver.press('Enter', context),
    () => driver.shutdown(context),
  ]) await expect(operation()).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
});
