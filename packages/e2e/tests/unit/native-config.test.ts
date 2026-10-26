import { describe, expect, it, vi } from 'vitest';
import { assignPorts, resolveConfig } from '../../src/config/resolve.ts';
import { defineEngine, type EngineAppDeclaration } from '../../src/engine/index.ts';
import { dispatchAgentStep, type DispatchSpec } from '../../src/agent/act.ts';
import { Invocation, type AgentContext, type AgentSelection } from '../../src/agent/invocation.ts';
import { createAgent } from '../../src/agent/default-agent.ts';

const projectRoot = '/tmp/native-config';
const descriptor = { name: 'native-test', version: '1', spiVersion: 1, platform: 'desktop' } as const;

describe('native app configuration', () => {
  it('merges target fields over engine defaults and keeps them through port assignment', () => {
    const validateApp = vi.fn();
    const engine = defineEngine({ ...descriptor, app: { appPath: '/bin/default', launchArguments: ['default'] }, validateApp });
    const config = resolveConfig({ targets: [{ engine, app: { appPath: '/bin/selected' } }] }, { projectRoot, env: {} });
    expect(config.targets[0]!.app).toMatchObject({ appPath: '/bin/selected', launchArguments: ['default'], identity: '/bin/selected' });
    expect(validateApp).toHaveBeenCalledWith({ appPath: '/bin/selected', launchArguments: ['default'] }, { targetName: 'desktop' });
    expect(assignPorts(config, {}).targets[0]!.app.appPath).toBe('/bin/selected');
  });

  it.each([
    { appPath: '' }, { appPath: 'x\0y' }, { launchArguments: [3] },
    { launchArguments: ['x\0y'] }, { unknownLaunch: true },
  ])('rejects malformed native declarations: %j', (app) => {
    expect(() => resolveConfig({ targets: [{ engine: defineEngine(descriptor), app: app as EngineAppDeclaration }] }, { projectRoot })).toThrow();
  });

  it('rejects asynchronous validation instead of ignoring its rejection', () => {
    const engine = defineEngine({ ...descriptor, async validateApp() { throw new Error('late validation'); } });
    expect(() => resolveConfig({ targets: [{ engine }] }, { projectRoot })).toThrow(/must finish synchronously/);
  });

  it('binds validation and settlement methods inherited from a class', async () => {
    class Base {
      name = descriptor.name; version = descriptor.version; spiVersion = descriptor.spiVersion;
      seen: string[] = [];
      validateApp(_app: EngineAppDeclaration, info: { targetName: string }) { this.seen.push(info.targetName); }
      async settleAttempt() { this.seen.push('settled'); }
    }
    class Native extends Base { platform = 'desktop'; }
    const implementation = new Native();
    const engine = defineEngine(implementation);
    resolveConfig({ targets: [{ engine }] }, { projectRoot });
    await engine.settleAttempt!({ signal: new AbortController().signal, timeoutMs: 10 });
    expect(implementation.seen).toEqual(['desktop', 'settled']);
  });
});

describe('explicit model policy', () => {
  it('resolves model false without silently enabling a judge and lets CLI policy override config', () => {
    const config = resolveConfig({ targets: [{ platform: 'desktop' }], modelPolicy: 'allow', agents: { default: { model: false } } }, { projectRoot, cli: { modelPolicy: 'forbid' } });
    expect(config.modelPolicy).toBe('forbid');
    expect(config.agent).toMatchObject({ modelDisabled: true, model: undefined, judge: undefined });
    expect(() => resolveConfig({ targets: [{ platform: 'desktop' }], modelPolicy: 'sometimes' as never }, { projectRoot })).toThrow(/modelPolicy/);
  });

  it.each([false, true])('blocks built-in act before opening a step or touching a replay cache (explicit executor: %s)', async (explicit) => {
    const config = resolveConfig({ targets: [{ platform: 'desktop' }], modelPolicy: 'forbid', ...(explicit ? { agents: { default: createAgent() } } : {}) }, { projectRoot });
    const selection = { config: config.agent, executor: config.agent.executor ?? { name: 'lazy', async runStep() { throw new Error('must not run'); } } } as AgentSelection;
    const steps = { run: vi.fn(() => { throw new Error('must not reach step or replay'); }) };
    const runtime = { config, steps, select: () => selection } as unknown as AgentContext;
    await expect(dispatchAgentStep(runtime, { agent: undefined } as DispatchSpec)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(steps.run).not.toHaveBeenCalled();
  });

  it('blocks the judgment tier before observations or adapters are acquired', () => {
    const config = resolveConfig({ targets: [{ platform: 'desktop' }], agents: { default: { model: false } } }, { projectRoot });
    const judge = vi.fn();
    const runtime = { config, select: () => ({ config: config.agent, judge }) } as unknown as AgentContext;
    expect(() => new Invocation(runtime, { api: 'agent.assert', task: 'assert', timeoutMs: 100, maxModelCalls: 1, vision: false })).toThrow(/disabled by model policy/);
    expect(judge).not.toHaveBeenCalled();
  });
});
