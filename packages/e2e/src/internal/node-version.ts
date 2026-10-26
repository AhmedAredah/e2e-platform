/** Validate the runtime before loading dependencies that require newer Node APIs. */
const MINIMUM_NODE_VERSION = '22.22.3';
export const SUPPORTED_NODE_RANGE = `^${MINIMUM_NODE_VERSION} || >=24.8.0`;

function parse(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
}

/** Mirrors the public package engine range, including its unsupported 23.x gap. */
export function unsupportedNodeMessage(current: string): string | undefined {
  const [major, minor, patch] = parse(current);
  if ((major === 22 && (minor > 22 || (minor === 22 && patch >= 3)))
    || major > 24 || (major === 24 && minor >= 8)) return undefined;
  return `e2e-cpp requires Node.js ${MINIMUM_NODE_VERSION}+ in the 22.x line, or 24.8.0+; this is Node.js ${current.replace(/^v/, '')}. Upgrade Node.js, or switch versions with your version manager (nvm use 22, fnm use 22, volta pin node@22).`;
}
