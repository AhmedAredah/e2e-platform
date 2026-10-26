/** Offline documentation shipped with this fork, without assuming a hosted site. */
export function documentationCommand(page = ''): string {
  const topic = page.startsWith('/reference/mcp') ? 'mcp'
    : page.startsWith('/explore') ? 'explore'
      : page.startsWith('/subscriptions') || page.startsWith('/telemetry') ? 'setup'
        : page.startsWith('/reference/cli') || page.startsWith('/cache') ? 'running' : '';
  return `npx --no-install e2e-platform guide${topic === '' ? '' : ` ${topic}`}`;
}
