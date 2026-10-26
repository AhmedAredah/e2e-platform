import { parseKey } from '@e2e-platform/core/engine';
import { TerminalError } from '../model/types.ts';

const SIMPLE: Readonly<Record<string, string>> = {
  Enter: '\r', Escape: '\x1b', Tab: '\t', Backspace: '\x7f', Space: ' ',
  ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
  Home: '\x1b[H', End: '\x1b[F', Insert: '\x1b[2~', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~',
  F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS', F5: '\x1b[15~', F6: '\x1b[17~',
  F7: '\x1b[18~', F8: '\x1b[19~', F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
};

/** Encodes supported xterm keys; impossible OS shortcuts fail explicitly. */
export function encodeKey(key: string, options: { readonly applicationCursorKeys?: boolean } = {}): string {
  const parsed = parseKey(key);
  if (parsed === undefined) throw new TerminalError('UNSUPPORTED_KEY', `Unsupported terminal key: ${key}`);
  const modifiers = new Set(parsed.modifiers.map((modifier) => modifier === 'ControlOrMeta' ? (process.platform === 'darwin' ? 'Meta' : 'Control') : modifier));
  if (modifiers.has('Meta')) throw new TerminalError('UNSUPPORTED_KEY', 'Meta shortcuts have no portable terminal byte encoding');
  const shift = modifiers.has('Shift');
  const control = modifiers.has('Control');
  const alt = modifiers.has('Alt');
  if (parsed.key.kind === 'char' || parsed.key.name === 'Space') {
    let character = parsed.key.kind === 'char' ? parsed.key.char : ' ';
    if (shift && /^[a-z]$/u.test(character)) character = character.toUpperCase();
    if (control) {
      const upper = character.toUpperCase();
      if (upper === ' ' || upper === '@') character = '\0';
      else if (upper.length === 1 && upper.charCodeAt(0) >= 65 && upper.charCodeAt(0) <= 95) character = String.fromCharCode(upper.charCodeAt(0) - 64);
      else if (upper === '?') character = '\x7f';
      else throw new TerminalError('UNSUPPORTED_KEY', 'Control key has no supported terminal byte encoding');
    }
    return `${alt ? '\x1b' : ''}${character}`;
  }
  const name = parsed.key.name;
  if (name === 'Tab' && shift && !control && !alt) return '\x1b[Z';
  const base = SIMPLE[name];
  if (base === undefined) throw new TerminalError('UNSUPPORTED_KEY', `Unsupported terminal key: ${key}`);
  const modifier = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (control ? 4 : 0);
  if (modifier === 1) {
    if (options.applicationCursorKeys === true && /^(Arrow|Home$|End$)/u.test(name)) return base.replace('\x1b[', '\x1bO');
    return base;
  }
  const tail = base.startsWith('\x1b[') ? base.slice(2) : '';
  if (/^[A-Z]$/u.test(tail)) return `\x1b[1;${modifier}${base.at(-1)}`;
  if (base.startsWith('\x1bO') && /^[P-S]$/u.test(base.slice(2))) return `\x1b[1;${modifier}${base.at(-1)}`;
  if (/^\d+~$/u.test(tail)) return base.replace('~', `;${modifier}~`);
  // Alt+Enter/Escape/Backspace is expressible as an escape prefix.
  if (alt && !control && !shift) return `\x1b${base}`;
  throw new TerminalError('UNSUPPORTED_KEY', `Unsupported terminal key combination: ${key}`);
}
