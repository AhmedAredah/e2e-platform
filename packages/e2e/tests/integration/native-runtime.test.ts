import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, runProject, resultByTitle } from '../helpers/run-project.ts';
import { assertValidReport } from '../helpers/report-schema.ts';
import type { Engine, EngineInitInfo } from '../../src/engine/index.ts';

const builtEngine = '../../dist/engine/index.js';
const { defineEngine, EngineError } = await import(builtEngine) as typeof import('../../src/engine/index.ts');
const base = { name: 'deterministic', version: '1', spiVersion: 1, platform: 'desktop' } as const;

/** Runs a small real fixture against an in-process engine. */
async function execute(engine: Engine, body: string, extra = {}) {
  return runProject({ 'tests/native.e2e.ts': `import { test } from '@e2e-cpp/core'; test('native', async (fixtures) => { ${body} });` }, {
    appUrl: '', config: { targets: [{ engine: defineEngine(engine), app: { appPath: '/bin/example', launchArguments: ['--test'] } }], artifacts: [], modelPolicy: 'forbid', ...extra },
  });
}

describe('native runtime integration', () => {
  it('retains redacted startup diagnostics when startAttempt fails', async () => {
    const { outcome, project } = await execute({ ...base,
      async startAttempt(context) {
        context.appLog({ source: 'error', level: 'error', text: 'Startup failed with startup-secret-1832' });
        context.environment({ helper: '1' });
        throw new EngineError('ENGINE_FAILURE', 'helper startup failed', { retryable: false });
      },
    }, 'void fixtures;', { secrets: { startup: 'startup-secret-1832' } });
    try {
      expect(outcome.exitCode).not.toBe(0);
      const artifacts = resultByTitle(outcome, 'native').attempts[0]!.artifacts;
      expect(artifacts).toHaveLength(2);
      const log = artifacts.find((artifact) => artifact.path?.endsWith('application.log'))!;
      const text = readFileSync(path.join(project.dir, '.e2e', 'artifacts', log.path!), 'utf8');
      expect(text).toContain('Startup failed');
      expect(text).not.toContain('startup-secret-1832');
    } finally { project.cleanup(); }
  });

  it('propagates CLI --no-model into file-configured workers', async () => {
    const project = createProject({
      'e2e.config.ts': `export default { targets: [{ platform: 'desktop' }], workers: 2, artifacts: [], modelPolicy: 'allow' };`,
      'tests/policy.e2e.ts': `import { test } from '@e2e-cpp/core'; test('acquires deterministic agent', ({ agent }) => { void agent; });`,
    });
    try {
      const cli = fileURLToPath(new URL('../../dist/cli/bin.js', import.meta.url));
      const result = await promisify(execFile)(process.execPath, [cli, 'run', '--no-model'], { cwd: project.dir, env: { ...process.env, CI: '' }, timeout: 20_000 });
      expect(result.stdout).toContain('passed');
    } finally { project.cleanup(); }
  });

  it('opens native apps without a URL and records redacted engine diagnostics', async () => {
    let init: EngineInitInfo | undefined;
    let restarts = 0;
    const { outcome, project } = await execute({ ...base,
      async init(value) { init = value; },
      async startAttempt(context) { context.environment({ nativeVersion: '1.2' }); context.appLog({ source: 'console', level: 'info', text: 'password secret-marker-1842' }); },
      session: { async restart() { restarts++; } },
    }, 'await fixtures.app.open();', { secrets: { password: 'secret-marker-1842' } });
    try {
      expect(outcome.exitCode).toBe(0);
      expect(init!.app).toMatchObject({ appPath: '/bin/example', launchArguments: ['--test'] });
      expect(restarts).toBe(1);
      const artifacts = resultByTitle(outcome, 'native').attempts[0]!.artifacts;
      expect(artifacts).toHaveLength(2);
      const log = artifacts.find((artifact) => artifact.path?.endsWith('application.log'))!;
      const text = readFileSync(path.join(project.dir, '.e2e', 'artifacts', log.path!), 'utf8');
      expect(text).not.toContain('secret-marker-1842');
      expect(text).toContain('<secret:password>');
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });

  it.each(['verdict', 'cleanup'] as const)('cannot pass a fault discovered during %s settlement', async (when) => {
    let closed = false;
    let surfaced = false;
    const { outcome, project } = await execute({ ...base,
      async startAttempt(context) { context.appLog({ source: 'error', level: 'warning', text: 'Fault diagnostics' }); },
      async endAttempt() { closed = true; },
      async settleAttempt() {
        if (!surfaced && (when === 'verdict' || closed)) { surfaced = true; throw new EngineError('ENGINE_FAILURE', 'late transport disconnect', { retryable: false }); }
      },
    }, 'void fixtures;');
    try {
      expect(outcome.exitCode).not.toBe(0);
      expect(resultByTitle(outcome, 'native').attempts[0]!.status).toBe('failed');
      expect(closed).toBe(true);
      expect(resultByTitle(outcome, 'native').attempts[0]!.artifacts.some((artifact) => artifact.path?.endsWith('application.log'))).toBe(true);
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });

  it('allows agent acquisition in explicit deterministic mode but blocks built-in execution', async () => {
    const acquired = await execute(base, 'void fixtures.agent;', { modelPolicy: 'allow', agents: { default: { model: false } } });
    try { expect(acquired.outcome.exitCode).toBe(0); } finally { acquired.project.cleanup(); }
    const blocked = await execute(base, 'await fixtures.agent.act("do something");');
    try {
      expect(blocked.outcome.exitCode).not.toBe(0);
      expect(resultByTitle(blocked.outcome, 'native').attempts[0]!.error?.code).toBe('MODEL_UNAVAILABLE');
    } finally { blocked.project.cleanup(); }
  });

  it('runs trusted custom executors with no model under forbid', async () => {
    let calls = 0;
    const { outcome, project } = await execute({ ...base, async observe() { return { root: { ref: { id: 'root', revision: '' }, role: 'window' }, viewport: { width: 100, height: 100 } }; } }, 'await fixtures.agent.act("deterministic action");', {
      agents: { default: { name: 'local-executor', cache: 'off', async runStep() { calls++; return { status: 'passed', summary: 'completed locally' }; } } },
    });
    try { expect(outcome.exitCode, JSON.stringify(outcome.report)).toBe(0); expect(calls).toBe(1); } finally { project.cleanup(); }
  });
});
