import { EngineError, OBSERVED_NAME_LIMIT, OBSERVED_TEXT_LIMIT, type EngineSnapshot, type ObservationPixels, type SemanticNode } from '@e2e-cpp/core/engine';
import { isRecord } from '../transport/json-rpc-tcp.ts';

const STATES = ['checked', 'disabled', 'selected', 'expanded', 'pressed', 'focused', 'hidden', 'secure'] as const;
const PURPOSES = ['username', 'password', 'one-time-code', 'generic-secret', 'none'] as const;
const MAX_NODES = 20_000;
const MAX_DEPTH = 64;

export interface ParsedSnapshot { readonly snapshot: EngineSnapshot; readonly secureCount: number }

export function parseSnapshot(value: unknown, observed: boolean, includePixels = true): ParsedSnapshot {
  if (!isRecord(value) || !isRecord(value.viewport)) throw invalid('snapshot shape');
  if (value.treeUnavailable !== undefined) throw invalid('unavailable semantic capture is unsupported');
  const width = dimension(value.viewport.width);
  const height = dimension(value.viewport.height);
  const ids = new Set<string>();
  let secureCount = 0;
  const node = (raw: unknown, depth: number): SemanticNode => {
    if (depth > MAX_DEPTH || ids.size >= MAX_NODES || !isRecord(raw) || !isRecord(raw.ref)) throw invalid('snapshot node limit or shape');
    const id = string(raw.ref.id, 512);
    if (id === '' || ids.has(id)) throw invalid('duplicate or empty node id');
    ids.add(id);
    const result: { -readonly [K in keyof SemanticNode]: SemanticNode[K] } = { ref: { id, revision: '' } };
    if (raw.states !== undefined) {
      if (!isRecord(raw.states)) throw invalid('node states');
      const states: Partial<Record<typeof STATES[number], boolean>> = {};
      for (const key of STATES) {
        if (raw.states[key] !== undefined) {
          if (typeof raw.states[key] !== 'boolean') throw invalid('node state');
          states[key] = raw.states[key];
        }
      }
      result.states = states;
    }
    const secure = result.states?.secure === true;
    if (secure) {
      secureCount++;
      // A buggy helper must not get a second chance to leak values in attributes.
      if (['value', 'text', 'selection', 'attributes'].some((key) => raw[key] !== undefined) || (Array.isArray(raw.children) && raw.children.length > 0)) throw invalid('secure node contains observable content');
    }
    if (raw.role !== undefined) result.role = string(raw.role, 128);
    if (raw.name !== undefined) result.name = string(raw.name, 65_536).slice(0, observed ? OBSERVED_NAME_LIMIT : 65_536);
    if (!secure) {
      for (const key of ['text', 'value'] as const) {
        if (raw[key] !== undefined) result[key] = string(raw[key], 65_536).slice(0, observed && key !== 'value' ? OBSERVED_TEXT_LIMIT : 65_536);
      }
      if (raw.attributes !== undefined) {
        if (!isRecord(raw.attributes) || Object.keys(raw.attributes).length > 64) throw invalid('node attributes');
        result.attributes = Object.fromEntries(Object.entries(raw.attributes).map(([key, entry]) => [string(key, 128), string(entry, 4096)]));
      }
    }
    if (raw.testId !== undefined) result.testId = string(raw.testId, 1024);
    if (raw.selector !== undefined) result.selector = string(raw.selector, 4096);
    if (raw.inputPurpose !== undefined) {
      if (!PURPOSES.includes(raw.inputPurpose as typeof PURPOSES[number])) throw invalid('input purpose');
      result.inputPurpose = raw.inputPurpose as typeof PURPOSES[number];
    }
    if (raw.level !== undefined) {
      if (!Number.isInteger(raw.level) || Number(raw.level) < 1 || Number(raw.level) > 6) throw invalid('heading level');
      result.level = Number(raw.level);
    }
    if (raw.rect !== undefined) {
      if (!isRecord(raw.rect)) throw invalid('node rectangle');
      const { x, y, width: rectWidth, height: rectHeight } = raw.rect;
      if (![x, y, rectWidth, rectHeight].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000) || Number(rectWidth) < 0 || Number(rectHeight) < 0) throw invalid('node rectangle');
      result.rect = { x: Number(x), y: Number(y), width: Number(rectWidth), height: Number(rectHeight) };
    }
    if (raw.children !== undefined) {
      if (!Array.isArray(raw.children)) throw invalid('node children');
      result.children = raw.children.map((child) => node(child, depth + 1));
    }
    return result;
  };
  const root = node(value.root, 0);
  const snapshot: { -readonly [K in keyof EngineSnapshot]: EngineSnapshot[K] } = { root, viewport: { width, height } };
  if (value.location !== undefined) snapshot.location = string(value.location, 4096);
  if (value.truncated !== undefined) {
    if (typeof value.truncated !== 'boolean') throw invalid('snapshot truncated flag');
    snapshot.truncated = value.truncated;
  }
  if (includePixels && value.screenshot !== undefined) {
    const pixels = parseScreenshot(value.screenshot, secureCount);
    if (Math.abs(pixels.pixels.width / pixels.pixels.scale - width) > 1 || Math.abs(pixels.pixels.height / pixels.pixels.scale - height) > 1) throw invalid('screenshot does not match the viewport');
    snapshot.pixels = pixels.pixels;
    snapshot.maskedRegionCount = pixels.maskedRegionCount;
  }
  return { snapshot, secureCount };
}

/** The helper must mask at source and attest coverage; raw screenshots never enter the runner. */
export function parseScreenshot(value: unknown, secureCount: number): { pixels: ObservationPixels; maskedRegionCount: number } {
  if (!isRecord(value) || value.masked !== true || value.mimeType !== 'image/png' || typeof value.base64 !== 'string' || value.base64.length > 32 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64) || value.base64.length % 4 !== 0) throw invalid('unmasked or invalid screenshot');
  const width = dimension(value.width);
  const height = dimension(value.height);
  if (width * height > 64_000_000) throw invalid('screenshot pixel limit');
  if (!Number.isSafeInteger(value.maskedRegionCount) || Number(value.maskedRegionCount) < secureCount) throw invalid('screenshot secure coverage');
  const data = Buffer.from(value.base64, 'base64');
  if (data.length < 33 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || data.subarray(12, 16).toString('ascii') !== 'IHDR' || data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height) throw invalid('screenshot PNG header');
  const scale = value.scale === undefined ? 1 : Number(value.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16) throw invalid('screenshot scale');
  return { pixels: { data, mediaType: 'image/png', width, height, scale }, maskedRegionCount: Number(value.maskedRegionCount) };
}

function dimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 32768) throw invalid('viewport/image dimension');
  return value;
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw invalid('string bound');
  return value;
}
function invalid(what: string): EngineError { return new EngineError('ENGINE_FAILURE', `native bridge rejected: ${what}`, { retryable: false }); }
