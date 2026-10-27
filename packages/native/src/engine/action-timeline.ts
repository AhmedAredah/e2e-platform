import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ENGINE_ERROR_CODES, type LocatorActionKind } from '@e2e-platform/core/engine';

type Operation = 'perform' | 'keyboard.type' | 'keyboard.press' | 'window.activate' | 'restart';
interface TimelineEntry {
  readonly operation: Operation;
  readonly action?: LocatorActionKind;
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly status: 'passed' | 'failed';
  readonly code?: string;
}

/** Bounded diagnostic history. Never records node IDs, titles, values, keys, paths or raw errors. */
export class NativeActionTimeline {
  private readonly started = Date.now();
  private readonly entries: TimelineEntry[] = [];
  private omitted = 0;

  async record<T>(operation: Operation, action: LocatorActionKind | undefined, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let code: string | undefined;
    let status: 'passed' | 'failed' = 'passed';
    try { return await work(); }
    catch (error) {
      status = 'failed';
      // Error messages and custom getters may contain application secrets.
      try {
        const value: unknown = error !== null && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
        code = typeof value === 'string' && ENGINE_ERROR_CODES.includes(value as typeof ENGINE_ERROR_CODES[number]) ? value : 'ENGINE_FAILURE';
      } catch { code = 'ENGINE_FAILURE'; }
      throw error;
    } finally {
      if (this.entries.length < 1000) this.entries.push({ operation, ...(action === undefined ? {} : { action }), elapsedMs: Math.max(0, started - this.started), durationMs: Math.max(0, Date.now() - started), status, ...(code === undefined ? {} : { code }) });
      else this.omitted++;
    }
  }

  async write(artifactsDir: string): Promise<string> {
    const relative = 'native/actions.json';
    await mkdir(path.join(artifactsDir, 'native'), { recursive: true });
    await writeFile(path.join(artifactsDir, relative), JSON.stringify({ format: 'native-actions-1', omitted: this.omitted, entries: this.entries }, null, 2) + '\n', { mode: 0o600 });
    return relative;
  }
}
