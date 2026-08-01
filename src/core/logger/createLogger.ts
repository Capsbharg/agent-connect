import pino from 'pino';
import type { Logger } from './Logger.js';

function wrap(pinoLogger: pino.Logger): Logger {
  return {
    debug: (msg, meta) => pinoLogger.debug(meta ?? {}, msg),
    info: (msg, meta) => pinoLogger.info(meta ?? {}, msg),
    warn: (msg, meta) => pinoLogger.warn(meta ?? {}, msg),
    error: (msg, meta) => pinoLogger.error(meta ?? {}, msg),
    child: (bindings) => wrap(pinoLogger.child(bindings)),
  };
}

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
}

/** The only place in the framework that imports pino directly. */
export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const level = opts.level ?? 'info';
  const pretty = opts.pretty ?? process.stdout.isTTY === true;

  const pinoLogger = pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });

  return wrap(pinoLogger);
}
