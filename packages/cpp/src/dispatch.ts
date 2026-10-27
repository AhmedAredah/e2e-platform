import { isDeepStrictEqual } from 'node:util';
import { expect, type FixtureContext, type Locator, type Role, type Screen, type TestFixtures } from '@e2e-platform/core';
import type { ProcessFixture } from '@e2e-platform/process';
import { createHttpClient } from '@e2e-platform/protocol';
import { invalid, record, string, timeout, type Request } from './protocol.ts';

interface RecordedOperations {
  http(params: Record<string, unknown>): Promise<unknown>;
  equal(params: Record<string, unknown>): Promise<void>;
  truth(params: Record<string, unknown>): Promise<void>;
}

/** Resolves a bounded semantic query chain through the runner's public API. */
function locator(screen: Screen, input: unknown): Locator {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32) invalid();
  let current: Screen = screen;
  for (const value of input) {
    const part = record(value, ['kind', 'value', 'name', 'exact']);
    const text = string(part.value);
    if (part.exact !== undefined && typeof part.exact !== 'boolean') invalid();
    const options = part.exact === undefined ? {} : { exact: part.exact as boolean };
    switch (part.kind) {
      case 'role': current = current.getByRole(text as Role, { ...options, ...(part.name === undefined ? {} : { name: string(part.name) }) }); break;
      case 'text': current = current.getByText(text, options); break;
      case 'label': current = current.getByLabel(text, options); break;
      case 'placeholder': current = current.getByPlaceholder(text, options); break;
      case 'displayValue': current = current.getByDisplayValue(text, options); break;
      case 'testId': current = current.getByTestId(text); break;
      default: invalid();
    }
  }
  return current as Locator;
}

/** Provides only explicitly supported operations to the owned C++ child. */
export class CppDispatcher {
  private readonly operations: RecordedOperations;
  constructor(private readonly fixtures: TestFixtures & { processes: ProcessFixture }, private readonly context: FixtureContext) {
    this.operations = context.fixture<RecordedOperations>('cpp', {
      http: params => this.http(params),
      async equal(params) {
        record(params, ['actual', 'expected']);
        if (!Object.hasOwn(params, 'actual') || !Object.hasOwn(params, 'expected')) invalid();
        expect(isDeepStrictEqual(params.actual, params.expected), 'C++ equality assertion failed').toBe(true);
      },
      async truth(params) {
        record(params, ['actual']);
        expect(params.actual === true, 'C++ truth assertion failed').toBe(true);
      },
    }, { http: { kind: 'resource', label: () => 'HTTP request' }, equal: { kind: 'assertion', label: () => 'C++ equality assertion' }, truth: { kind: 'assertion', label: () => 'C++ truth assertion' } });
  }

  /** Dispatches from a closed allowlist; values never become source code. */
  async dispatch(request: Request): Promise<unknown> {
    const p = request.params;
    switch (request.method) {
      case 'app.open': record(p, ['path']); await this.fixtures.app.open(p.path === undefined ? undefined : string(p.path)); return null;
      case 'app.restart': record(p, []); await this.fixtures.app.restart(); return null;
      case 'app.clearState': record(p, []); await this.fixtures.app.clearState(); return null;
      case 'app.back': record(p, []); await this.fixtures.app.back(); return null;
      case 'app.screenshot': record(p, ['label']); return this.fixtures.app.screenshot(p.label === undefined ? undefined : string(p.label));
      case 'app.baseUrl': record(p, []); return this.fixtures.app.baseUrl ?? null;
      case 'locator.action': return this.action(p);
      case 'locator.read': return this.read(p);
      case 'locator.assert': return this.assert(p);
      case 'process.run': return this.process(p);
      case 'http.request': return this.operations.http(p);
      case 'expect.equal': await this.operations.equal(p); return null;
      case 'expect.true': await this.operations.truth(p); return null;
      default: invalid();
    }
  }

  /** Executes one action; the engine controls actionability and dispatch semantics. */
  private async action(p: Record<string, unknown>): Promise<null> {
    record(p, ['selector', 'action', 'value']);
    const target = locator(this.fixtures.screen, p.selector);
    switch (p.action) {
      case 'tap': await target.tap(); break;
      case 'doubleTap': await target.doubleTap(); break;
      case 'secondaryTap': await target.secondaryTap(); break;
      case 'fill': await target.fill(string(p.value)); break;
      case 'press': await target.press(string(p.value)); break;
      case 'check': await target.check(); break;
      case 'uncheck': await target.uncheck(); break;
      case 'selectOption': await target.selectOption(string(p.value)); break;
      case 'scrollIntoView': await target.scrollIntoView(); break;
      case 'focus': await target.focus(); break;
      case 'hover': await target.hover(); break;
      case 'clear': await target.clear(); break;
      default: invalid();
    }
    return null;
  }

  /** Reads through locators rather than retaining stale native references. */
  private async read(p: Record<string, unknown>): Promise<unknown> {
    record(p, ['selector', 'property']);
    const target = locator(this.fixtures.screen, p.selector);
    switch (p.property) {
      case 'textContent': return target.textContent();
      case 'inputValue': return target.inputValue();
      case 'count': return target.count();
      default: invalid();
    }
  }

  /** Uses the same polling assertions as TypeScript tests. */
  private async assert(p: Record<string, unknown>): Promise<null> {
    record(p, ['selector', 'matcher', 'expected', 'negate', 'timeoutMs']);
    if (p.negate !== undefined && typeof p.negate !== 'boolean') invalid();
    const target = expect(locator(this.fixtures.screen, p.selector));
    const assertion = p.negate === true ? target.not : target;
    const options = p.timeoutMs === undefined ? {} : { timeout: timeout(p.timeoutMs, 5000) };
    switch (p.matcher) {
      case 'toBeVisible': await assertion.toBeVisible(options); break;
      case 'toBeHidden': await assertion.toBeHidden(options); break;
      case 'toBeEnabled': await assertion.toBeEnabled(options); break;
      case 'toBeDisabled': await assertion.toBeDisabled(options); break;
      case 'toBeChecked': await assertion.toBeChecked(options); break;
      case 'toHaveText': await assertion.toHaveText(string(p.expected), options); break;
      case 'toContainText': await assertion.toContainText(string(p.expected), options); break;
      case 'toHaveValue': await assertion.toHaveValue(string(p.expected), options); break;
      case 'toHaveCount': {
        if (typeof p.expected !== 'number' || !Number.isSafeInteger(p.expected) || p.expected < 0) invalid();
        await assertion.toHaveCount(p.expected, options); break;
      }
      default: invalid();
    }
    return null;
  }

  /** Runs finite commands through the attempt-owned process fixture. */
  private async process(p: Record<string, unknown>): Promise<unknown> {
    record(p, ['executable', 'args', 'stdin', 'expectedExitCodes', 'timeoutMs']);
    if (p.args !== undefined && (!Array.isArray(p.args) || p.args.length > 1024)) invalid();
    if (p.expectedExitCodes !== undefined && (!Array.isArray(p.expectedExitCodes) || p.expectedExitCodes.length === 0 || p.expectedExitCodes.length > 256 || p.expectedExitCodes.some(code => typeof code !== 'number' || !Number.isSafeInteger(code) || code < 0 || code > 4_294_967_295))) invalid();
    const result = await this.fixtures.processes.run({
      executable: string(p.executable), args: (p.args as unknown[] | undefined)?.map(value => string(value)) ?? [],
      ...(p.stdin === undefined ? {} : { stdin: string(p.stdin) }),
      ...(p.expectedExitCodes === undefined ? {} : { expectedExitCodes: p.expectedExitCodes as number[] }),
      timeoutMs: timeout(p.timeoutMs, 30_000), maxOutputBytes: 128 * 1024, signal: this.context.signal,
    });
    return { status: result.status, exitCode: result.exitCode, stdout: result.stdout.bytes.toString('utf8'), stderr: result.stderr.bytes.toString('utf8'), truncated: result.stdout.truncated || result.stderr.truncated };
  }

  /** HTTP transport stays bounded and follows the protocol package's URL policy. */
  private async http(p: Record<string, unknown>): Promise<unknown> {
    record(p, ['url', 'method', 'headers', 'body', 'timeoutMs']);
    const headers = p.headers === undefined ? {} : Object.fromEntries(Object.entries(record(p.headers)).map(([key, value]) => [string(key, 1024), string(value, 16 * 1024)]));
    const client = createHttpClient({ baseUrl: string(p.url), maxResponseBytes: 128 * 1024, timeoutMs: timeout(p.timeoutMs, 30_000) });
    const response = await client.request(string(p.url), { method: p.method === undefined ? 'GET' : string(p.method, 32), headers, ...(p.body === undefined ? {} : { body: string(p.body) }), signal: this.context.signal });
    return { status: response.status, headers: response.headers, body: response.text() };
  }
}
