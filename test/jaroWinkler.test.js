import { test, expect } from 'vitest';
import { jaroWinkler } from '../utils/jaroWinkler.js';

test('Jaro-Winkler similarity matching', () => {
  // apex logistics vs apex diagnostics should not be high similarity (threshold 0.90)
  expect(jaroWinkler('Apex Logistics', 'Apex Diagnostics')).toBeLessThan(0.90);
  
  // similar names should match
  expect(jaroWinkler('Apex Logistics Limited', 'Apex Logistics')).toBeGreaterThanOrEqual(0.90);
});
