/** Attempt-scoped artifact directory and report registration. */

import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { readFile, stat, realpath, rm, writeFile } from 'node:fs/promises';
import { processSecrets } from '../internal/redact.ts';
import { TestError } from '../internal/errors.ts';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ArtifactStore } from '../types.ts';
import type { ArtifactRegistration, ArtifactSink } from './fixtures.ts';
import type { ArtifactRecord } from './records.ts';

/**
 * How much of each kind the runner masked, unless the registration says. A
 * screenshot masks secure fields at the source; a log passes through the
 * secret redactor. A recording masks nothing: a secure field renders its own
 * dots, but anything else the screen showed is in the frames. A trace is
 * decided per attempt by whoever stops it (see `redactTraceArchives`): one
 * registered without that verdict was not rewritten, and says so.
 */
const REDACTION_BY_KIND: Readonly<Record<ArtifactRecord['kind'], ArtifactRecord['redaction']>> = {
  screenshot: 'complete',
  trace: 'incomplete',
  video: 'incomplete',
  download: 'complete',
  log: 'complete',
};

export interface AttemptArtifacts {
  /** Absolute attempt artifact directory, created eagerly. */
  readonly dir: string;
  /** Report-order artifact records; the sink appends to this array. */
  readonly records: ArtifactRecord[];
  readonly sink: ArtifactSink;
  /**
   * Resolves once every registered file has been measured and hashed.
   * Registration itself is synchronous and cheap; the size and digest of a
   * file (a trace zip can be tens of megabytes) are filled in off the event
   * loop, so awaiting this before the record is read is what makes them
   * complete.
   */
  settle(): Promise<void>;
}

/**
 * Creates the artifact directory for one attempt and a sink that registers
 * produced files under report-relative paths, measuring and hashing them
 * asynchronously. With a `store`, each complete artifact is also handed to it
 * right then — as produced, not at run end — and the store's reference lands
 * on the record as `ref`.
 */
export function createAttemptArtifacts(options: {
  artifactsRoot: string;
  /** Report path segments, e.g. [targetName, sanitizedTestId, attempt-N]. */
  segments: readonly string[];
  attemptId: string;
  /** When provided, artifacts are attributed to the currently running step. */
  currentStepId?: () => string | undefined;
  /** Host store every artifact is handed to once complete; undefined keeps files local only. */
  store?: ArtifactStore;
  /**
   * Report identity handed to the store with each artifact. `attemptId` is
   * the attempt the REPORT files the artifact under; a serial member's
   * artifacts land on the group attempt's record, so its store identity is the
   * group's id while its own ids (`<attemptId>:artifact:N`) still mint from
   * the member. Defaults to `attemptId`.
   */
  identity?: { readonly runId: string; readonly testId: string; readonly attemptId?: string };
}): AttemptArtifacts {
  const dir = path.join(options.artifactsRoot, ...options.segments);
  mkdirSync(dir, { recursive: true });
  const records: ArtifactRecord[] = [];
  const pending: Promise<void>[] = [];

  const sink: ArtifactSink = {
    dir,
    register: (kind, relativePath, registration?: ArtifactRegistration) => {
      const id = `${options.attemptId}:artifact:${records.length}`;
      const absolute = path.resolve(dir, relativePath);
      if (!isInside(dir, absolute)) throw new TestError('ARTIFACT_PATH_INVALID', 'artifact path must stay inside its attempt directory');
      const stepId = options.currentStepId?.();
      const startedAt = registration?.startedAt;
      const record: ArtifactRecord = {
        id,
        kind,
        mediaType: mediaTypeFor(relativePath),
        ...(startedAt === undefined ? {} : { startedAt }),
        redaction: registration?.redaction ?? REDACTION_BY_KIND[kind],
        producer: stepId === undefined ? { kind: 'attempt' } : { kind: 'step', stepId },
      };
      records.push(record);
      const reportPath = path.posix.join(...options.segments, relativePath);
      pending.push(
        (async () => {
          const resolved = await realpath(absolute).catch(() => undefined);
          if (resolved === undefined) return;
          if (!isInside(await realpath(dir), resolved)) {
            record.redaction = 'incomplete';
            return;
          }
          if (kind === 'download' || kind === 'log') {
            if (!(await sanitizeTextArtifact(absolute))) {
              record.redaction = 'incomplete';
              await rm(absolute, { force: true });
              return;
            }
            record.redaction = 'complete';
          }
          // Without a store the file is streamed for its size and digest only;
          // with one it is read whole, since the store needs the bytes anyway,
          // and hashed from that same buffer. A file that never appeared is
          // recorded without size or digest either way.
          if (options.store === undefined) {
            const measured = await measure(absolute);
            if (measured === undefined) return;
            record.path = reportPath;
            record.size = measured.size;
            record.sha256 = measured.sha256;
            return;
          }
          const bytes = await readFile(absolute).catch(() => undefined);
          if (bytes === undefined) return;
          record.path = reportPath;
          record.size = bytes.byteLength;
          record.sha256 = createHash('sha256').update(bytes).digest('hex');
          // The store's failure is its own: the record keeps its local path and
          // simply carries no ref, and the run is never failed by evidence
          // that did not upload.
          try {
            const { ref } = await options.store.put({
              kind,
              mediaType: record.mediaType,
              bytes,
              size: record.size,
              sha256: record.sha256,
              path: reportPath,
              runId: options.identity?.runId ?? '',
              testId: options.identity?.testId ?? '',
              attemptId: options.identity?.attemptId ?? options.attemptId,
              ...(stepId === undefined ? {} : { stepId }),
              ...(startedAt === undefined ? {} : { startedAt }),
            });
            if (typeof ref === 'string' && ref !== '') {
              if (processSecrets.redact(ref) === ref) record.ref = ref;
              else record.redaction = 'incomplete';
            }
          } catch {
            // best-effort by contract
          }
        })(),
      );
      return id;
    },
  };

  const settle = async (): Promise<void> => {
    // Registrations may land while earlier ones are still hashing.
    while (pending.length > 0) await Promise.all(pending.splice(0));
  };

  return { dir, records, sink, settle };
}

/** Size and SHA-256 of one file, streamed; undefined when it cannot be read. */
async function measure(absolute: string): Promise<{ size: number; sha256: string } | undefined> {
  try {
    const { size } = await stat(absolute);
    const hash = createHash('sha256');
    await pipeline(createReadStream(absolute), hash);
    return { size, sha256: hash.digest('hex') };
  } catch {
    return undefined;
  }
}

/** Restricts a report filename to a safe alphabet. Input is already published prose. */
export function sanitizePathSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

/** A stable, bounded directory name that cannot expose a clipped test title. */
export function artifactIdentitySegment(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mediaTypeFor(relativePath: string): string {
  if (relativePath.endsWith('.png')) return 'image/png';
  if (relativePath.endsWith('.zip')) return 'application/zip';
  if (relativePath.endsWith('.webm')) return 'video/webm';
  if (relativePath.endsWith('.mp4')) return 'video/mp4';
  if (relativePath.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

/** A producer may register only files within its own evidence directory. */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Rewrite bounded UTF-8 text before hashing/uploading; opaque or oversized downloads fail closed. */
async function sanitizeTextArtifact(absolute: string): Promise<boolean> {
  const info = await stat(absolute).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size > 8 * 1024 * 1024) return false;
  const bytes = await readFile(absolute);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
  if (text.includes('\0')) return false;
  await writeFile(absolute, processSecrets.redact(text), { mode: 0o600 });
  return true;
}
