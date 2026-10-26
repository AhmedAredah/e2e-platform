/**
 * `e2e login` and `e2e logout`: sign in to a personal subscription
 * (ChatGPT Plus/Pro, GitHub Copilot, SuperGrok) so a config can construct
 * its model from `@e2e-platform/oauth`. The flows live in that package; the CLI
 * calls its typed entry points, resolved from the project so the runner
 * itself never depends on any provider.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pc from 'picocolors';

/** The providers `@e2e-platform/oauth` signs in to; commander rejects anything else as a usage error. */
export const LOGIN_PROVIDERS = ['openai', 'github-copilot', 'spacexai'] as const;

export interface LoginOptions {
  readonly device?: boolean;
  readonly clientId?: string;
  readonly fromGh?: boolean;
  readonly enterpriseUrl?: string;
}

/** What `@e2e-platform/oauth/cli` exports; typed here because the runner cannot import the package. */
interface OAuthCli {
  runLogin(providerId: string | undefined, options: { method?: 'device'; clientId?: string; fromGitHubCli?: boolean; enterpriseUrl?: string }): Promise<number>;
  runLogout(providerId: string | undefined): Promise<number>;
}

/** Loads `@e2e-platform/oauth/cli` from the project, or explains how to add it. */
async function loadOAuthCli(cwd: string): Promise<OAuthCli | undefined> {
  const require = createRequire(path.join(cwd, 'package.json'));
  let resolved: string;
  try {
    resolved = require.resolve('@e2e-platform/oauth/cli');
  } catch {
    process.stderr.write(
      `${pc.red('error:')} @e2e-platform/oauth is not installed in this project. Add it with ${pc.cyan('npm i -D @e2e-platform/oauth')}, then import a model from it in e2e.config.ts, e.g. ${pc.cyan("import { chatgpt } from '@e2e-platform/oauth/chatgpt'")}.\n`,
    );
    return undefined;
  }
  return (await import(pathToFileURL(resolved).href)) as OAuthCli;
}

/** Signs in to `provider`, or without one lets the user pick. */
export async function login(cwd: string, provider: string | undefined, options: LoginOptions): Promise<number> {
  const cli = await loadOAuthCli(cwd);
  if (cli === undefined) return 1;
  return cli.runLogin(provider, {
    ...(options.device === true ? { method: 'device' } : {}),
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.fromGh === true ? { fromGitHubCli: true } : {}),
    ...(options.enterpriseUrl === undefined ? {} : { enterpriseUrl: options.enterpriseUrl }),
  });
}

/** Forgets the login of `provider`, or without one lets the user pick among the stored ones. */
export async function logout(cwd: string, provider: string | undefined): Promise<number> {
  const cli = await loadOAuthCli(cwd);
  if (cli === undefined) return 1;
  return cli.runLogout(provider);
}
