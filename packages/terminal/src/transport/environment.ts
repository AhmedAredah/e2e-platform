/** Applies platform environment-key semantics before creating the native PTY. */
export function terminalEnvironment(inherited: NodeJS.ProcessEnv, overrides: Readonly<Record<string, string | undefined>>, windows: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entries of [inherited, overrides]) {
    for (const [name, value] of Object.entries(entries)) {
      if (windows) for (const existing of Object.keys(result)) if (existing.toUpperCase() === name.toUpperCase()) delete result[existing];
      if (value === undefined) delete result[name]; else result[name] = value;
    }
  }
  if (!Object.keys(result).some(name => windows ? name.toUpperCase() === 'TERM' : name === 'TERM')) result.TERM = 'xterm-256color';
  return result;
}
