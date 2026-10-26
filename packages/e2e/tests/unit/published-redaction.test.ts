import { describe, expect, it } from 'vitest';
import { createRunEventEmitter, type RunEvent } from '../../src/run/events.ts';
import { opaqueIdentity, redactPublishedRecord } from '../../src/internal/published-redaction.ts';
import { registerStaticSecrets } from '../../src/run/secrecy.ts';
import { processSecrets, SecretLedger } from '../../src/internal/redact.ts';
import { validateWorkerMessage } from '../../src/run/worker/protocol.ts';
import { AiTraceCollector, AiTraceRecorder, withAiTraceScope } from '../../src/internal/ai-trace.ts';
import { buildPrompt } from '../../src/agent/prompts.ts';
import { validateVerdict } from '../../src/agent/act-validation.ts';
import { bounded, ellipsize } from '../../src/report/format.ts';
import { catalogLine } from '../../src/mcp/tools.ts';
import { loadAiSdk } from '../../src/agent/ai-sdk.ts';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { assertValidReport } from '../helpers/report-schema.ts';

describe('published structured output', () => {
  it('preserves control vocabulary while redacting data and keeping user identity joins unique', () => {
    const ledger = new SecretLedger([['first', 'failed'], ['second', 'ready'], ['digit', '1']]);
    const source = {
      schemaVersion: 'report-1', run: { id: '001122', status: 'failed', startedAt: '2026-01-01T00:00:00.000Z',
        targets: [{ id: 'ready', environment: 'test' }], summary: { failed: 1 },
        results: [{ id: 'a1', testId: 'test::failed', targetId: 'ready', titlePath: ['failed'], status: 'failed' },
          { id: 'b1', testId: 'test::ready', targetId: 'ready', titlePath: ['ready'], status: 'passed' }],
        cache: { mode: 'missed', reason: 'action-failed' },
      },
    };
    const output = redactPublishedRecord(source, ledger.redact);
    expect(output.run.status).toBe('failed');
    expect(output.schemaVersion).toBe('report-1');
    expect(output.run.summary).toEqual({ failed: 1 });
    expect(output.run.id).toBe(source.run.id);
    expect(output.run.cache).toEqual(source.run.cache);
    expect(output.run.results[0]!.titlePath).toEqual(['<secret:first>']);
    expect(output.run.results[0]!.targetId).toBe(output.run.targets[0]!.id);
    expect(output.run.results[0]!.testId).not.toBe(output.run.results[1]!.testId);
    expect(source.run.results[0]!.titlePath).toEqual(['failed']);
  });

  it('keeps event types usable and confidential test IDs consistent across events', () => {
    const secret = 'event-identity-secret-L18';
    processSecrets.register('event-token', secret);
    const seen: RunEvent[] = [];
    const emit = createRunEventEmitter([(event) => { seen.push(event); }]);
    emit({ type: 'test-started', testId: `file::${secret}`, agent: 'default', title: secret, file: 'file', serialId: undefined, target: 'native' });
    emit({ type: 'output', target: 'native', pair: { testId: `file::${secret}`, agent: 'default' }, stream: 'stdout', text: secret });
    expect(JSON.stringify(seen)).not.toContain(secret);
    expect(seen[0]).toMatchObject({ type: 'test-started', title: '<secret:event-token>' });
    expect((seen[0] as Extract<RunEvent, { type: 'test-started' }>).testId).toBe((seen[1] as Extract<RunEvent, { type: 'output' }>).pair?.testId);
  });

  it('preserves setup state and evidence references while redacting turn prose and DOM test IDs', () => {
    const ledger = new SecretLedger([['s', 'started'], ['f', 'finished'], ['r', 'reused'], ['digit', '1'], ['api', 'agent']]);
    const output = redactPublishedRecord({
      events: [{ type: 'setup', state: 'started' }, { type: 'setup', state: 'finished', outcome: 'reused' }],
      steps: [{ api: 'agent.act', outcome: 'reused', artifacts: ['artifact-1'] }],
      failure: { screen: 'artifact-1', screenshot: 'image-1', candidates: ['reused'] },
      artifacts: [{ id: 'artifact-1' }, { id: 'image-1' }],
      error: { details: { testId: 'started-field' } },
    }, ledger.redact);
    expect(output.events).toEqual([{ type: 'setup', state: 'started' }, { type: 'setup', state: 'finished', outcome: 'reused' }]);
    expect(output.steps[0]).toEqual({ api: 'agent.act', outcome: '<secret:r>', artifacts: ['artifact-1'] });
    expect(output.failure).toEqual({ screen: output.artifacts[0]!.id, screenshot: output.artifacts[1]!.id, candidates: ['<secret:r>'] });
    expect(output.error.details.testId).toBe('<secret:s>-field');
  });

  it('withholds confidential artifact routes without inventing links and preserves schema-valid metadata', () => {
    const ledger = new SecretLedger([['digit', '1']]);
    const source = { artifacts: [
      { id: 'artifact-1', kind: 'log', mediaType: 'text/plain', path: 'test/attempt-1/log.txt', ref: 'store://bucket/1',
        size: 1, sha256: '1'.repeat(64), redaction: 'complete', producer: { kind: 'attempt' } },
      { id: 'artifact-2', kind: 'log', mediaType: 'text/plain', path: 'safe/log.txt', ref: 'store://bucket/safe',
        size: 2, sha256: 'a'.repeat(64), redaction: 'complete', producer: { kind: 'attempt' } },
    ] };
    const output = redactPublishedRecord(source, ledger.redact);
    expect(output.artifacts[0]).toEqual({ id: 'artifact-1', kind: 'log', mediaType: 'text/plain',
      size: 1, sha256: '1'.repeat(64), redaction: 'incomplete', producer: { kind: 'attempt' } });
    expect(output.artifacts[1]).toEqual(source.artifacts[1]);
    const document = JSON.parse(readFileSync(new URL('../../schema/fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
    document.run.results[0].attempts[0].artifacts = output.artifacts;
    assertValidReport(document);
  });

  it('keeps all identity joins stable when a provider resolves after the first event', () => {
    const secret = 'late-provider-name-M83';
    registerStaticSecrets(new Map([['late', { name: 'late', purpose: 'generic-secret', value: () => secret }]]));
    const seen: RunEvent[] = [];
    const emit = createRunEventEmitter([(event) => { seen.push(event); }]);
    const testId = `file::${secret}`;
    emit({ type: 'test-started', testId, agent: secret, title: 'ordinary title', file: 'file', serialId: `serial::${testId}`, target: secret });
    processSecrets.register('late', secret);
    emit({ type: 'output', target: secret, pair: { testId, agent: secret }, stream: 'stdout', text: secret });
    const start = seen[0] as Extract<RunEvent, { type: 'test-started' }>;
    const output = seen[1] as Extract<RunEvent, { type: 'output' }>;
    expect(start.testId).toBe(output.pair?.testId);
    expect(start.agent).toBe(output.pair?.agent);
    expect(start.target).toBe(output.target);
    expect(JSON.stringify(seen)).not.toContain(secret);
    expect(start.testId).toBe(opaqueIdentity(testId));
    expect(redactPublishedRecord(start, processSecrets.redact)).toEqual(start);
  });
});

describe('worker protocol validation', () => {
  const result = { type: 'result', result: { test: { id: 'test', file: 'test.ts', kind: 'test', titlePath: ['test'] },
    agent: 'default', status: 'failed', selected: true, attempts: [{ id: 'attempt', startedAt: '', status: 'failed',
      cleanup: 'complete', steps: [], secondaryErrors: [] }] } };
  it('accepts ordinary control messages and failed results', () => {
    expect(validateWorkerMessage({ type: 'ready' })).toBe(true);
    expect(validateWorkerMessage(result)).toBe(true);
    expect(validateWorkerMessage({ type: 'unit-done', unitId: 'unit', runErrors: [] })).toBe(true);
  });
  it('rejects unknown discriminators and damaged verdicts instead of treating them as passes', () => {
    expect(validateWorkerMessage({ type: '<secret:token>' })).toBe(false);
    for (const status of ['<secret:token>', undefined, ['failed']]) {
      expect(validateWorkerMessage({ ...result, result: { ...result.result, status } })).toBe(false);
      expect(validateWorkerMessage({ ...result, result: { ...result.result, attempts: [{ ...result.result.attempts[0], status }] } })).toBe(false);
    }
  });
});

it('redacts trace labels before clipping, including values registered after the run began', async () => {
  const secret = 'trace-boundary-secret-X79-123456';
  const recorder = new AiTraceRecorder();
  await withAiTraceScope({ test: 'case', testId: 'test', target: 'native', agent: 'default', attempt: 0,
    api: 'agent.act', label: 'x'.repeat(65) + secret }, async () => {
    await recorder.telemetry.onStart?.({ callId: 'late-value', operationId: 'ai.generateText' } as never);
  });
  processSecrets.register('trace-token', secret);
  const collector = new AiTraceCollector();
  collector.merge(recorder.drain());
  const trace = collector.document();
  expect(JSON.stringify(trace)).not.toContain(secret.slice(0, 15));
  expect(trace.runs[0]!.function_id).toContain('<secret:trace-');
  expect(trace.runs[0]!.e2e?.label).toContain('<secret:trace-token>');
});

it('keeps trace aliases and schema valid across recorder and collector redaction passes', async () => {
  processSecrets.register('trace-digit', '1');
  const recorder = new AiTraceRecorder();
  await withAiTraceScope({ test: 'case', testId: 'file::case1', target: 'native', agent: 'default', attempt: 0,
    api: 'agent.act', label: 'inspect' }, async () => {
    await recorder.telemetry.onStart?.({ callId: 'trace-joins', operationId: 'ai.generateText' } as never);
  });
  const first = recorder.drain();
  const collector = new AiTraceCollector();
  collector.merge(first);
  const second = collector.document();
  expect(second.runs[0]!.e2e).toEqual(first.runs[0]!.e2e);
  expect(second.runs[0]!.function_id).toBe(first.runs[0]!.function_id);
  expect(second.runs[0]!.e2e?.testId).toBe(opaqueIdentity('file::case1'));
  expect(second.runs[0]!.e2e?.api).toBe('agent.act');
});

it('filters complete values before repair, verdict, catalog and terminal excerpts are shortened', async () => {
  const secret = 'excerpt-boundary-secret-N87-9412';
  processSecrets.register('excerpt-token', secret);
  const across = (bound: number) => 'x'.repeat(bound - 12) + secret;
  const prompt = buildPrompt({ request: 'repair', instruction: 'inspect', repair: { issue: 'invalid response', rawText: across(2000) } });
  const verdict = validateVerdict({ status: 'passed', summary: across(2000) }, 'fixture');
  await loadAiSdk();
  const catalog = catalogLine('fixture', { inputSchema: z.object({}), description: across(160) }, false);
  for (const output of [prompt, verdict.summary, catalog, bounded(across(8192)), ellipsize(across(80), 80)]) {
    expect(output).not.toContain(secret.slice(0, 12));
  }
});
