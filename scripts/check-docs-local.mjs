/** Checks documentation navigation and local Markdown links without contacting a hosting service. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Enumerates the maintained documentation pages, excluding generated and example code. */
function pages(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'examples') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? pages(path) : /\.mdx?$/.test(entry.name) ? [path] : [];
  });
}

/** Resolves a page or asset in the documentation source. */
function localExists(path) {
  return existsSync(path) || (!extname(path) && ['.mdx', '.md', '/index.mdx'].some((suffix) => existsSync(path + suffix)));
}

/** Reports missing navigation pages and literal local links, retaining all errors for one review. */
export function validateDocumentation(root) {
  const errors = [];
  const navigation = JSON.parse(readFileSync(join(root, 'docs.json'), 'utf8'));
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.pages)) {
      for (const page of value.pages) {
        if (typeof page === 'string' && !/^https?:\/\//.test(page) && !localExists(join(root, page))) errors.push(`navigation: ${page}`);
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(navigation.navigation);
  const files = pages(root);
  for (const file of files) {
    const source = readFileSync(file, 'utf8').replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```/gm, '');
    for (const match of source.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href) || href.includes('{')) continue;
      const path = decodeURIComponent(href.split(/[?#]/, 1)[0]);
      if (!path) continue;
      const target = path.startsWith('/') ? join(root, path.slice(1)) : resolve(dirname(file), path);
      if (!localExists(target)) errors.push(`${file}: ${href}`);
    }
  }
  return { checkedPages: files.length, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = validateDocumentation(fileURLToPath(new URL('../docs', import.meta.url)));
  if (result.errors.length) {
    process.stderr.write(`Missing local documentation targets:\n${result.errors.join('\n')}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Local documentation navigation and links: ${result.checkedPages} pages passed.\n`);
}
