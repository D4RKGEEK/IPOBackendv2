import { test, expect } from 'vitest';
import { writeAtomicSync } from '../utils/atomicWrite.js';
import fs from 'fs';
import path from 'path';

test('writes file atomically', () => {
  const testPath = path.join(__dirname, 'test_atomic_file.json');
  const testData = { success: true };
  
  writeAtomicSync(testPath, testData);
  
  expect(fs.existsSync(testPath)).toBe(true);
  const readData = JSON.parse(fs.readFileSync(testPath, 'utf8'));
  expect(readData).toEqual(testData);
  
  // Clean up
  if (fs.existsSync(testPath)) {
    fs.unlinkSync(testPath);
  }
});
