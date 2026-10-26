import { describe, expect, it } from 'vitest';
import { resolveExpression } from '../../src/engine/resolve-expression.ts';
import type { LocatorExpression, SemanticNode, TextPattern } from '../../src/engine/contract.ts';

const literal = (value: string): TextPattern => ({ kind: 'string', value, exact: true });
const byId = (value: string): LocatorExpression => ({ kind: 'query', query: { kind: 'testId', value: literal(value) } });
const node = (id: string, fields: Partial<SemanticNode> = {}): SemanticNode => ({ ref: { id, revision: '' }, testId: id, ...fields });
const ids = (expression: LocatorExpression, roots: readonly SemanticNode[]) => resolveExpression(expression, roots).map((entry) => entry.ref.id);

describe('semantic tree locator resolution', () => {
  it('selects the innermost text while retaining document order', () => {
    const roots = [node('parent', { text: 'Ready', children: [node('child', { text: 'Ready' })] }), node('sibling', { name: 'Ready' })];
    expect(ids({ kind: 'query', query: { kind: 'text', value: literal('Ready') } }, roots)).toEqual(['child', 'sibling']);
  });

  it('keeps filters and scopes inside strict descendants', () => {
    const roots = [node('a', { role: 'group', children: [node('item', { text: 'chosen' })] }), node('b', { role: 'group', children: [node('other', { text: 'other' })] })];
    const groups: LocatorExpression = { kind: 'query', query: { kind: 'role', value: literal('group') } };
    expect(ids({ kind: 'filter', source: groups, has: byId('item'), hasText: literal('chosen') }, roots)).toEqual(['a']);
    expect(ids({ kind: 'query', query: { kind: 'testId', value: literal('a') }, scope: byId('a') }, roots)).toEqual([]);
    expect(ids({ kind: 'query', query: { kind: 'testId', value: literal('other') }, scope: byId('a') }, roots)).toEqual([]);
    expect(ids({ kind: 'index', source: groups, index: 'last' }, roots)).toEqual(['b']);
  });

  it('respects role visibility and state predicates without hiding other query kinds', () => {
    const roots = [node('hidden', { role: 'button', name: 'Save', states: { hidden: true } }), node('visible', { role: 'button', name: 'Save', states: { disabled: false } })];
    expect(ids({ kind: 'query', query: { kind: 'role', value: literal('button'), name: literal('Save'), states: { disabled: false } } }, roots)).toEqual(['visible']);
    expect(ids(byId('hidden'), roots)).toEqual(['hidden']);
    expect(ids({ kind: 'query', query: { kind: 'testId', value: literal('hidden'), visible: true } }, roots)).toEqual([]);
  });

  it('distinguishes an unavailable name from an explicitly empty name', () => {
    const roots = [node('unknown', { role: 'button' }), node('empty', { role: 'button', name: '' })];
    const query = { kind: 'role' as const, value: literal('button') };
    expect(ids({ kind: 'query', query }, roots)).toEqual(['unknown', 'empty']);
    expect(ids({ kind: 'query', query: { ...query, name: literal('') } }, roots)).toEqual(['empty']);
    expect(ids({ kind: 'query', query: { ...query, name: { kind: 'regexp', source: '^$', flags: '' } } }, roots)).toEqual(['empty']);
  });

  it('refuses unsupported selectors and malformed forests', () => {
    expect(() => resolveExpression({ kind: 'selector', selector: '.button' }, [])).toThrow(/native selector/);
    expect(() => resolveExpression({ kind: 'frame', selector: 'iframe', source: byId('x') }, [])).toThrow(/nested documents/);
    const shared = node('x');
    expect(() => resolveExpression(byId('x'), [shared, shared])).toThrow(/cyclic, shared/);
  });
});
