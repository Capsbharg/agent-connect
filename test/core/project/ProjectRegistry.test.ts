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
    fs.writeFileSync(
      configPath,
      JSON.stringify({ valid: validPath, missing: path.join(dir, 'does-not-exist') }),
    );

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

  describe('agent/model overrides', () => {
    it('a plain string entry (the original format) has no overrides', () => {
      fs.writeFileSync(configPath, JSON.stringify({ demo: dir }));
      const registry = new ProjectRegistry(configPath, createTestLogger());
      registry.load();

      expect(registry.getPath('demo')).toBe(dir);
      expect(registry.getAgentOverride('demo')).toBeUndefined();
      expect(registry.getModelOverride('demo')).toBeUndefined();
    });

    it('an object entry can set agent and/or model alongside path', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ demo: { path: dir, agent: 'cursor', model: 'gpt-5' } }),
      );
      const registry = new ProjectRegistry(configPath, createTestLogger());
      registry.load();

      expect(registry.isValid('demo')).toBe(true);
      expect(registry.getPath('demo')).toBe(dir);
      expect(registry.getAgentOverride('demo')).toBe('cursor');
      expect(registry.getModelOverride('demo')).toBe('gpt-5');
    });

    it('an object entry with only some fields leaves the rest undefined', () => {
      fs.writeFileSync(configPath, JSON.stringify({ demo: { path: dir, agent: 'codex' } }));
      const registry = new ProjectRegistry(configPath, createTestLogger());
      registry.load();

      expect(registry.getAgentOverride('demo')).toBe('codex');
      expect(registry.getModelOverride('demo')).toBeUndefined();
    });

    it('rejects an object entry with no path (and does not silently accept it)', () => {
      fs.writeFileSync(configPath, JSON.stringify({ demo: { agent: 'cursor' } }));
      const registry = new ProjectRegistry(configPath, createTestLogger());
      registry.load();

      expect(registry.isValid('demo')).toBe(false);
    });

    it('rejects an object entry whose path does not exist on disk', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ demo: { path: path.join(dir, 'does-not-exist'), agent: 'cursor' } }),
      );
      const registry = new ProjectRegistry(configPath, createTestLogger());
      registry.load();

      expect(registry.isValid('demo')).toBe(false);
    });

    it('ignores non-string agent/model fields rather than throwing', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ demo: { path: dir, agent: 123, model: null } }),
      );
      const registry = new ProjectRegistry(configPath, createTestLogger());
      registry.load();

      expect(registry.isValid('demo')).toBe(true);
      expect(registry.getAgentOverride('demo')).toBeUndefined();
      expect(registry.getModelOverride('demo')).toBeUndefined();
    });
  });
});
