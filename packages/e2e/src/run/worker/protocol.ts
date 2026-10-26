/**
 * Protocol between the scheduler and one target worker. Every message is
 * JSON-serializable so the same shapes work over a child-process IPC channel
 * and in-process (see `run/unit-runner.ts`). Two things deliberately never
 * cross: `ResolvedTarget`, which may hold a live engine handle, and test
 * functions. Work units therefore carry `TestIdentity` and the worker pairs
 * each identity with a locally resolved test function.
 */

import type { TestIdentity } from '../../collect/collect.ts';
import type { ResolvedTestOptions } from '../../collect/select.ts';
import type { CliOverrides, PortAssignments, ResolvedTarget } from '../../config/resolve.ts';
import type { AiTraceSnapshot } from '../../internal/ai-trace.ts';
import type { DebugSnapshot } from '../../internal/debug.ts';
import type { SerializedError } from '../../internal/errors.ts';
import type { ResultRecord, RunError, SerialGroupRecord } from '../records.ts';
import type { StepProgress } from '../steps.ts';

/** One runnable pair on the wire; the worker resolves the test function. */
export interface WirePair {
  readonly test: TestIdentity;
  /** The configured agent this pair runs as; one test may appear once per agent. */
  readonly agent: string;
  readonly options: ResolvedTestOptions;
}

/**
 * Bootstrap payload for a child-process worker. Transport-private: the
 * scheduler never builds one, because run-wide settings are closed over by the
 * spawn factory rather than sent as a message.
 */
export interface WorkerBootstrapMessage {
  readonly type: 'bootstrap';
  readonly bootstrap: WorkerBootstrap;
}

/** Everything a child-process worker can receive. */
export type ChildProcessInbound = WorkerBootstrapMessage | MainToWorker;

export interface WorkerBootstrap {
  readonly configPath: string;
  readonly projectRoot: string;
  readonly configDigest: string;
  /**
   * The runner's command-line overrides. A worker re-resolves the config from
   * the same file, so without these it would silently disagree with the runner
   * about anything a flag changed — `--retries` among them. The config digest covers only the file, so the mismatch check cannot
   * catch it.
   */
  readonly cli: CliOverrides;
  /**
   * The free ports the runner assigned to app URLs declared with port 0, by
   * target name. Chosen once in the runner and outside the digest, so a
   * worker must be told them to resolve the same URLs.
   */
  readonly ports: PortAssignments;
  readonly targetName: string;
  /** This worker's slot among the target's workers; see `EngineInitInfo.workerSlot`. */
  readonly workerSlot: number;
  readonly runId: string;
  readonly artifactsRoot: string;
  readonly headed: boolean;
  readonly sessionsRoot: string;
  /** Per-run AES key; transferred only over this channel, never disk or env. */
  readonly sessionKeyBase64: string;
  /** Whether the worker should collect `--debug` phase timings. */
  readonly debug: boolean;
  /** Whether the worker should record model calls for `--ai-trace`. */
  readonly aiTrace: boolean;
}

export interface RunUnitMessage {
  readonly type: 'run-unit';
  readonly unitId: string;
  readonly kind: 'setup' | 'file';
  readonly file: string;
  readonly absolutePath: string;
  readonly pairs: readonly WirePair[];
}

export interface InterruptMessage {
  readonly type: 'interrupt';
}

export interface ShutdownMessage {
  readonly type: 'shutdown';
}

/**
 * A forced interrupt: dispose the engine now, beside whatever the running
 * unit is still doing, and exit. The runner kills the worker once the cleanup
 * budget is spent, so the engine gets exactly one bounded chance to let go.
 */
export interface TerminateMessage {
  readonly type: 'terminate';
}

export type MainToWorker = RunUnitMessage | InterruptMessage | ShutdownMessage | TerminateMessage;

/**
 * `ResultRecord` minus the live target. Serializable as-is: `test` is a
 * `TestIdentity` and every other field is plain data.
 */
export type WireResultRecord = Omit<ResultRecord, 'target'>;

export interface ReadyMessage {
  readonly type: 'ready';
}

/** One pair about to execute, as reporters see it. */
export interface PairStart {
  readonly testId: string;
  /** The configured agent the pair runs as; with the test id, the pair's identity. */
  readonly agent: string;
  /** Joined title path, so reporters need no side lookup by test ID. */
  readonly title: string;
  /** Project-root-relative test file. */
  readonly file: string;
  /**
   * The pair's serial group, when it belongs to one. A serial unit announces
   * its members one at a time and the previous member has finished executing
   * when the next starts, though every member's result arrives together once
   * the group completes.
   */
  readonly serialId: string | undefined;
}

export interface PairStartMessage extends PairStart {
  readonly type: 'pair-start';
}

/** Live step progress of the running attempt; plain data, fire-and-forget. */
export interface ProgressMessage {
  readonly type: 'progress';
  readonly testId: string;
  readonly agent: string;
  readonly progress: StepProgress;
}

/**
 * Text a test wrote to the worker's stdout or stderr (`console.log` and
 * friends). The worker's streams are the runner's terminal, where a stray
 * line would land inside the live window, so the worker captures them and
 * the reporter prints each line above it, attributed to `pair` when one is
 * executing.
 */
export interface OutputMessage {
  readonly type: 'output';
  readonly pair: { readonly testId: string; readonly agent: string } | undefined;
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

export interface ResultMessage {
  readonly type: 'result';
  readonly result: WireResultRecord;
}

export interface SerialGroupMessage {
  readonly type: 'serial-group';
  readonly group: SerialGroupRecord;
}

export interface UnitDoneMessage {
  readonly type: 'unit-done';
  readonly unitId: string;
  readonly runErrors: readonly RunError[];
  /** Phase timings drained from this worker since the previous unit. */
  readonly debug?: DebugSnapshot;
  /** Model calls drained from this worker since the previous unit. */
  readonly aiTrace?: AiTraceSnapshot;
}

/**
 * The worker's last word before it exits: engine disposal happens after the
 * final unit drained its errors, so its outcome rides here.
 */
export interface ShutdownDoneMessage {
  readonly type: 'shutdown-done';
  readonly runErrors: readonly RunError[];
  /** Phase timings drained from this worker since the last unit. */
  readonly debug?: DebugSnapshot;
  /** Model calls drained from this worker since the last unit, open ones included. */
  readonly aiTrace?: AiTraceSnapshot;
}

export interface FatalMessage {
  readonly type: 'fatal';
  readonly error: SerializedError;
}

/**
 * The worker met a run-level configuration failure (an unusable model on
 * the first `agent` acquisition) and asks the run to stop. The worker stays
 * alive to finish reporting its unit as interrupted.
 */
export interface RunAbortMessage {
  readonly type: 'run-abort';
  readonly error: SerializedError;
}

export type WorkerToMain =
  | ReadyMessage
  | PairStartMessage
  | ProgressMessage
  | OutputMessage
  | ResultMessage
  | SerialGroupMessage
  | UnitDoneMessage
  | ShutdownDoneMessage
  | FatalMessage
  | RunAbortMessage;

/** Private process transport; plaintext protection state must never enter run events. */
export interface WorkerIpcEnvelope {
  readonly message: WorkerToMain;
  readonly secrets: readonly (readonly [name: string, value: string])[];
}

/** Validates the private envelope before installing protection and dispatching its public-free message. */
export function validateWorkerEnvelope(value: unknown): value is WorkerIpcEnvelope {
  return isRecord(value) && validateWorkerMessage(value['message']) &&
    arrayOf(value['secrets'], (entry) => Array.isArray(entry) && entry.length === 2 && entry.every((part) => typeof part === 'string'));
}

const RESULT_STATUSES = new Set(['passed', 'flaky', 'failed', 'timed-out', 'interrupted', 'skipped']);
const ATTEMPT_STATUSES = new Set(['passed', 'failed', 'timed-out', 'interrupted', 'skipped']);
const STEP_STATUSES = new Set(['passed', 'failed', 'blocked', 'timed-out', 'cancelled']);

/** Checks the control and verdict fields before the scheduler trusts a worker message. */
export function validateWorkerMessage(value: unknown): value is WorkerToMain {
  if (!isRecord(value)) return false;
  switch (value['type']) {
    case 'ready': return true;
    case 'pair-start': return strings(value, ['testId', 'agent', 'title', 'file']) &&
      (value['serialId'] === undefined || typeof value['serialId'] === 'string');
    case 'output': return typeof value['text'] === 'string' && oneOf(value['stream'], ['stdout', 'stderr']) &&
      (value['pair'] === undefined || (isRecord(value['pair']) && strings(value['pair'], ['testId', 'agent'])));
    case 'progress': return strings(value, ['testId', 'agent']) && validProgress(value['progress']);
    case 'result': {
      const result = value['result'];
      return isRecord(result) && isRecord(result['test']) && strings(result['test'], ['id', 'file']) &&
        oneOf(result['test']['kind'], ['test', 'setup']) && stringArray(result['test']['titlePath']) &&
        typeof result['agent'] === 'string' && typeof result['selected'] === 'boolean' &&
        oneOf(result['status'], RESULT_STATUSES) && arrayOf(result['attempts'], (item) => validAttempt(item, false));
    }
    case 'serial-group': {
      const group = value['group'];
      return isRecord(group) && strings(group, ['id', 'serialId', 'targetId', 'platform', 'agent', 'file']) &&
        stringArray(group['titlePath']) && stringArray(group['memberTestIds']) &&
        oneOf(group['status'], RESULT_STATUSES) && arrayOf(group['attempts'], (item) => validAttempt(item, true));
    }
    case 'unit-done': return typeof value['unitId'] === 'string' && validRunErrors(value['runErrors']);
    case 'shutdown-done': return validRunErrors(value['runErrors']);
    case 'fatal':
    case 'run-abort': return validError(value['error']);
    default: return false;
  }
}

/** JSON record checks do not coerce damaged verdicts into a valid category. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === 'string');
}
function oneOf(value: unknown, values: ReadonlySet<string> | readonly string[]): boolean {
  return typeof value === 'string' && (Array.isArray(values) ? values.includes(value) : (values as ReadonlySet<string>).has(value));
}
function stringArray(value: unknown): boolean {
  return arrayOf(value, (item) => typeof item === 'string');
}
function arrayOf(value: unknown, valid: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(valid);
}
function validError(value: unknown): boolean {
  return isRecord(value) && strings(value, ['code', 'message']) && typeof value['retryable'] === 'boolean' &&
    oneOf(value['category'], ['test', 'configuration', 'infrastructure', 'internal', 'interrupted']);
}
function validRunErrors(value: unknown): boolean {
  return arrayOf(value, (item) => isRecord(item) && validError(item['error']));
}
function validStep(value: unknown): boolean {
  return isRecord(value) && strings(value, ['id', 'api', 'label', 'startedAt']) && oneOf(value['status'], STEP_STATUSES) &&
    arrayOf(value['events'], (event) => isRecord(event) && oneOf(event['status'], ['passed', 'failed', 'cancelled'])) &&
    (value['error'] === undefined || validError(value['error']));
}
function validAttempt(value: unknown, serial: boolean): boolean {
  if (!isRecord(value) || !strings(value, ['id', 'startedAt']) || !oneOf(value['status'], ATTEMPT_STATUSES) ||
      !oneOf(value['cleanup'], ['complete', 'failed', 'forced']) ||
      !arrayOf(value['secondaryErrors'], validError) || (value['error'] !== undefined && !validError(value['error']))) return false;
  return serial
    ? arrayOf(value['members'], (member) => isRecord(member) && strings(member, ['id', 'testId', 'startedAt']) &&
      oneOf(member['status'], ATTEMPT_STATUSES) && arrayOf(member['steps'], validStep) &&
      arrayOf(member['secondaryErrors'], validError) && (member['error'] === undefined || validError(member['error'])))
    : arrayOf(value['steps'], validStep);
}
function validProgress(value: unknown): boolean {
  if (!isRecord(value) || typeof value['api'] !== 'string') return false;
  switch (value['phase']) {
    case 'start': return strings(value, ['kind', 'label']);
    case 'end': return strings(value, ['kind', 'label']) && oneOf(value['status'], STEP_STATUSES);
    case 'event': return isRecord(value['event']) && oneOf(value['event']['status'], ['passed', 'failed', 'cancelled']);
    case 'activity': return oneOf(value['activity'], ['observe', 'model', 'action']);
    case 'replay': return typeof value['active'] === 'boolean';
    default: return false;
  }
}

/** Strips the live target from a result for transport. */
export function encodeResult(record: ResultRecord): WireResultRecord {
  const { target: _target, ...rest } = record;
  return rest;
}

/** Reattaches the scheduler's resolved target to a wire result. */
export function decodeResult(wire: WireResultRecord, target: ResolvedTarget): ResultRecord {
  return { ...wire, target };
}
