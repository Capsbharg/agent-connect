import { vi } from 'vitest';
import type { Logger } from '../../src/core/logger/Logger.js';

export function createTestLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}
