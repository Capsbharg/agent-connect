import { describe, expect, it, vi } from 'vitest';
import { InMemoryStorageProvider } from '../../../src/core/storage/InMemoryStorageProvider.js';

describe('InMemoryStorageProvider', () => {
  it('round-trips get/set/delete', async () => {
    const storage = new InMemoryStorageProvider();
    expect(await storage.get('missing')).toBeNull();

    await storage.set('key', { a: 1 });
    expect(await storage.get('key')).toEqual({ a: 1 });

    await storage.delete('key');
    expect(await storage.get('key')).toBeNull();
  });

  it('expires a value after its ttlMs elapses', async () => {
    vi.useFakeTimers();
    try {
      const storage = new InMemoryStorageProvider();
      await storage.set('key', 'value', { ttlMs: 1000 });
      expect(await storage.get('key')).toBe('value');

      vi.advanceTimersByTime(1001);
      expect(await storage.get('key')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a value with no ttlMs never expires', async () => {
    vi.useFakeTimers();
    try {
      const storage = new InMemoryStorageProvider();
      await storage.set('key', 'value');
      vi.advanceTimersByTime(1000 * 60 * 60 * 24 * 365);
      expect(await storage.get('key')).toBe('value');
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() clears every stored value', async () => {
    const storage = new InMemoryStorageProvider();
    await storage.set('key', 'value');
    await storage.close();
    expect(await storage.get('key')).toBeNull();
  });
});
