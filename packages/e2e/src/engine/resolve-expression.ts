// SPDX-License-Identifier: MIT
// Semantic query rules adapted from the MIT base's agent-device/src/locate.ts.
import { matchesText } from '../internal/text.ts';
import { EngineError, type LocatorExpression, type SemanticNode, type SemanticQuery, type TextPattern } from './contract.ts';

interface IndexedNode {
  readonly node: SemanticNode;
  readonly start: number;
  end: number;
}

/** Resolves the semantic locator grammar over a bounded forest in document order. */
export function resolveExpression(expression: LocatorExpression, roots: readonly SemanticNode[]): SemanticNode[] {
  const entries: IndexedNode[] = [];
  const seen = new Set<SemanticNode>();
  const visit = (nodes: readonly SemanticNode[], depth: number): void => {
    if (depth > 64) throw malformed('semantic tree exceeds the locator depth limit');
    for (const node of nodes) {
      if (seen.has(node) || entries.length >= 20_000) throw malformed('semantic tree is cyclic, shared, or too large');
      seen.add(node);
      const entry: IndexedNode = { node, start: entries.length, end: entries.length };
      entries.push(entry);
      if (node.children !== undefined) visit(node.children, depth + 1);
      entry.end = entries.length;
    }
  };
  visit(roots, 0);
  return evaluate(expression, entries).map((entry) => entry.node);
}

/** Keeps subtree boundaries while evaluating filters and nested scopes. */
function evaluate(expression: LocatorExpression, entries: readonly IndexedNode[]): IndexedNode[] {
  switch (expression.kind) {
    case 'query': {
      const candidates = expression.scope === undefined ? entries : descendants(evaluate(expression.scope, entries), entries);
      const matches = candidates.filter((entry) => matchesQuery(entry.node, expression.query));
      if (expression.query.kind !== 'text') return matches;
      return matches.filter((entry, index) => {
        const next = matches[index + 1];
        return next === undefined || !contains(entry, next);
      });
    }
    case 'filter':
      return evaluate(expression.source, entries).filter((entry) => {
        const children = descendants([entry], entries);
        const pattern = expression.hasText;
        if (pattern !== undefined && ![entry, ...children].some(({ node }) => hasText(node, pattern))) return false;
        return expression.has === undefined || evaluate(expression.has, children).length > 0;
      });
    case 'index': {
      const matches = evaluate(expression.source, entries);
      const index = expression.index === 'first' ? 0 : expression.index === 'last' ? matches.length - 1 : expression.index;
      const node = matches[index];
      return node === undefined ? [] : [node];
    }
    case 'selector':
      throw new EngineError('UNSUPPORTED_CAPABILITY', 'This semantic surface does not implement native selector strings', { retryable: false });
    case 'frame':
      throw new EngineError('FRAME_NOT_FOUND', 'This semantic surface has no nested documents', { retryable: false });
  }
}

/** Tests strict containment using the pre-order subtree interval. */
function contains(parent: IndexedNode, child: IndexedNode): boolean {
  return child.start > parent.start && child.start < parent.end;
}

/** Returns strict descendants without duplicating nodes from overlapping scopes. */
function descendants(parents: readonly IndexedNode[], entries: readonly IndexedNode[]): IndexedNode[] {
  return entries.filter((entry) => parents.some((parent) => contains(parent, entry)));
}

/** Text filtering includes names, visible text, and display values within the subtree. */
function hasText(node: SemanticNode, pattern: TextPattern): boolean {
  return [node.name, node.text, node.value].some((value) => value !== undefined && matchesText(value, pattern));
}

/** Applies the MIT engine contract's visibility, role, state, and text rules. */
function matchesQuery(node: SemanticNode, query: SemanticQuery): boolean {
  if (query.visible === true && node.states?.hidden === true) return false;
  switch (query.kind) {
    case 'role': {
      if (query.value.kind !== 'string') throw malformed('role queries require a literal role');
      if (node.role !== query.value.value || node.states?.hidden === true) return false;
      if (query.name !== undefined && !matchesText(node.name ?? '', query.name)) return false;
      for (const key of ['checked', 'disabled', 'selected', 'expanded', 'pressed'] as const) {
        const wanted = query.states?.[key];
        if (wanted !== undefined && (node.states?.[key] ?? false) !== wanted) return false;
      }
      return query.level === undefined || query.level === node.level;
    }
    case 'label':
      return node.name !== undefined && matchesText(node.name, query.value);
    case 'placeholder':
      return node.attributes?.placeholder !== undefined && matchesText(node.attributes.placeholder, query.value);
    case 'text':
      return [node.name, node.text].some((value) => value !== undefined && matchesText(value, query.value));
    case 'displayValue':
      return node.value !== undefined && matchesText(node.value, query.value);
    case 'testId':
      return node.testId !== undefined && matchesText(node.testId, query.value);
  }
}

/** Refuses malformed semantic data instead of presenting an incomplete match set. */
function malformed(message: string): EngineError {
  return new EngineError('ENGINE_FAILURE', message, { retryable: false });
}
