import type { EngineFixtureContext } from '@e2e-platform/core/engine';
import type { NativeEngine } from '../engine/native-engine.ts';
import type { NativeWindow } from '../driver/native-driver.ts';

/** Optional desktop operations contributed by the selected native engine. */
export interface NativeApp {
  /** Enumerates only the helper's owned windows. Requires the windows capability. */
  windows(): Promise<readonly NativeWindow[]>;
  /** Requests activation once; verify the resulting active window with a polling assertion. */
  activateWindow(id: string): Promise<void>;
  /** Attaches the bounded value-free action timeline captured so far. */
  attachTimeline(): Promise<void>;
  /** An attempt-owned directory, when isolateProfile is enabled; preserved across app.restart(). */
  readonly profileDirectory: string | undefined;
}

export function createNativeFixture(engine: NativeEngine, context: EngineFixtureContext): NativeApp {
  return context.fixture('native', {
    windows: () => engine.windows(context.operation()),
    activateWindow: (id: string) => engine.activateWindow(id, context.operation()),
    async attachTimeline() { context.attachArtifact('log', await engine.writeTimeline()); },
    get profileDirectory() { return engine.profileDirectory; },
  }, {
    windows: { kind: 'resource' },
    activateWindow: { kind: 'resource' },
    attachTimeline: { kind: 'resource' },
  });
}
