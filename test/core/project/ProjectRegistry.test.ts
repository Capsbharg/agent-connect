import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRegistry } from '../../../src/core/project/ProjectRegistry.js';
import { createTestLogger } from '../../helpers/testLogger.js';

describe('ProjectRegistry', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-connect-test-'));
    configPath = path.join(dir, 'projects.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads only entries whose path exists on disk', () => {
    const validPath = path.join(dir, 'exists');
    fs.mkdirSync(validPath);
    fs.writeFileSync(configPath, JSON.stringify({ valid: validPath, missing: path.join(dir, 'does-not-exist') }));

    const registry = new ProjectRegistry(configPath, createTestLogger());
    registry.load();

    expect(registry.isValid('valid')).toBe(true);
    expect(registry.isValid('missing')).toBe(false);
    expect(registry.listNames()).toEqual(['valid']);
    expect(registry.getPath('valid')).toBe(validPath);
    expect(registry.getPath('missing')).toBeUndefined();
  });

  it('is an exact-key allowlist — names are never resolved as paths', () => {
    fs.writeFileSync(configPath, JSON.stringify({}));
    const registry = new ProjectRegistry(configPath, createTestLogger());
    registry.load();

    expect(registry.isValid('../etc/passwd')).toBe(false);
    expect(registry.getPath('../etc/passwd')).toBeUndefined();
  });

  it('handles a missing config file gracefully', () => {
    const registry = new ProjectRegistry(path.join(dir, 'nope.json'), createTestLogger());
    registry.load();
    expect(registry.listNames()).toEqual([]);
  });

  it('handles a malformed config file gracefully', () => {
    fs.writeFileSync(configPath, '{ not valid json');
    const registry = new ProjectRegistry(configPath, createTestLogger());
    registry.load();
    expect(registry.listNames()).toEqual([]);
  });
});
