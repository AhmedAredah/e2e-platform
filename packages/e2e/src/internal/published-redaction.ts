/** Field-aware redaction for runner-owned reports and event envelopes. */
import { createHash } from 'node:crypto';

/** Closed vocabulary and machine-generated metadata are not captured prose. */
const MACHINE_FIELDS = new Set([
  'type', 'kind', 'status', 'phase', 'category', 'code', 'errorCode', 'cleanup', 'api',
  'schemaVersion', 'specVersion', 'version', 'spiVersion', 'adapterVersion', 'policyVersion',
  'startedAt', 'finishedAt', 'createdAt', 'expiresAt', 'reportedAt', 'at',
  'id', 'runId', 'projectId', 'attemptId', 'stepId', 'artifactId', 'serialGroupId',
  'sha256', 'digest', 'configDigest', 'commit', 'observationRevision', 'revision',
  'visionDegraded', 'tokenAccounting', 'mode', 'ended', 'decision', 'redaction',
  'stream', 'activity', 'environment', 'arch', 'runtime', 'os', 'cause', 'mediaType', 'mimeType',
  'capabilities', 'artifactCapabilities', 'artifacts',
]);

/** User-derived identities must keep the same join key in every public record. */
const OPAQUE_FIELDS = new Set(['testId', 'testIds', 'memberTestIds', 'serialId', 'relatedId', 'scopeId']);
const NAMED_FIELDS = new Set(['targetId', 'targetName', 'agent', 'agents', 'target', 'targets']);
let providerIdentities = false;

/**
 * A provider can reveal that a configured name is confidential after its first
 * event. Select opaque names before that event; like the process secret ledger,
 * this conservative policy persists for the process lifetime.
 */
export function protectProviderIdentities(): void { providerIdentities = true; }

/** Reserved syntax cannot be a configured target/agent name or canonical test ID. */
export function opaqueIdentity(text: string): string {
  return /^redacted:[a-f0-9]{64}$/.test(text)
    ? text
    : `redacted:${createHash('sha256').update(text).digest('hex')}`;
}

/**
 * Copies a report/event without rewriting its schema keys, enums, hashes or
 * timestamps. All other string fields are data and are redacted. Sensitive
 * test/serial identities always receive stable opaque aliases, including
 * before a provider resolves, so two titles do not become one test and later
 * events still join earlier events. Configured names stay readable when all
 * secrets are static and the names do not contain one of those values.
 *
 * This is for the runner's closed record shapes, never arbitrary user JSON
 * (which uses redactJson). Internal IPC keeps its original identities and is
 * not a public diagnostic boundary.
 */
export function redactPublishedRecord<T>(value: T, redact: (text: string) => string): T {
  const named = (text: string): string => providerIdentities || redact(text) !== text ? opaqueIdentity(text) : text;
  const visit = (entry: unknown, key: string, parent: string, owner?: Record<string, unknown>): unknown => {
    if (typeof entry === 'string') {
      // ErrorDetails.testId is a user-supplied DOM attribute, not a runner join.
      if (parent !== 'details' && (OPAQUE_FIELDS.has(key) || (key === 'id' && parent === 'test'))) return opaqueIdentity(entry);
      if (NAMED_FIELDS.has(key) || (key === 'id' && parent === 'targets') ||
          (key === 'name' && parent === 'target')) return named(entry);
      if (key === 'tags') return redact(entry) === entry ? entry : opaqueIdentity(entry);
      if ((owner?.['type'] === 'setup' && (key === 'state' || key === 'outcome')) ||
          (parent === 'failure' && (key === 'screen' || key === 'screenshot'))) return entry;
      if (MACHINE_FIELDS.has(key) || parent === 'runner' || (key === 'reason' && parent === 'cache')) return entry;
      if (key === 'endpoint' && (entry === 'local' || entry === 'provider-default')) return entry;
      const safe = redact(entry);
      if ((key === 'baseOrigin' || key === 'endpoint') && safe !== entry) return 'https://redacted.invalid';
      return safe === '' && entry !== '' ? opaqueIdentity(entry) : safe;
    }
    if (Array.isArray(entry)) return entry.map((item) => visit(item, key, parent, owner));
    if (entry !== null && typeof entry === 'object') {
      const fields = entry as Record<string, unknown>;
      const artifact = key === 'artifacts' && typeof fields['id'] === 'string' && typeof fields['redaction'] === 'string';
      let withheld = false;
      const output = Object.fromEntries(Object.entries(fields).flatMap(([field, item]) => {
        // Rewriting a resource reference would point at something that does
        // not exist. Keep the evidence ID but explicitly withhold that route.
        if (artifact && (field === 'path' || field === 'ref') && typeof item === 'string' && redact(item) !== item) {
          withheld = true;
          return [];
        }
        return [[field, visit(item, field, key, fields)]];
      }));
      if (withheld) output['redaction'] = 'incomplete';
      return output;
    }
    return entry;
  };
  return visit(value, '', '') as T;
}
