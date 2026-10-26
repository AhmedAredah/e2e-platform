import { compareJson } from '@e2e-cpp/checks';
import { expect } from '@e2e-cpp/core';

/** The expected value is test-owned; never ask the application to validate its own calculation. */
export function checkCalculation(actual: unknown): void {
  const comparison = compareJson(actual, { schemaVersion: 1, operation: 'sum', operands: [0.1, 0.2], sum: 0.3 }, { numbers: { absolute: 1e-12 } });
  expect(comparison.matches, 'independent calculator output oracle').toBe(true);
}
