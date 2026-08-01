import type { Server } from 'node:http';
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Logger } from '../logger/Logger.js';
import type { BullMQQueueProvider } from '../queue/BullMQQueueProvider.js';

const BASE_PATH = '/admin/queues';

export interface QueueDashboardOptions {
  queue: BullMQQueueProvider<unknown>;
  port: number;
  logger: Logger;
}

/**
 * Read-only visibility into the execution queue (waiting/active/completed/
 * failed/delayed), for local debugging. Bound to 127.0.0.1 only — this has
 * no auth of its own and must never be exposed beyond localhost. Only usable
 * with BullMQQueueProvider (in-memory queues have no dashboard). Ports
 * bullBoardServer.js.
 */
export class QueueDashboard {
  private readonly app = express();
  private readonly port: number;
  private readonly logger: Logger;
  private server: Server | null = null;

  constructor(opts: QueueDashboardOptions) {
    this.port = opts.port;
    this.logger = opts.logger;

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath(BASE_PATH);
    createBullBoard({ queues: [new BullMQAdapter(opts.queue.getBullQueue())], serverAdapter });
    this.app.use(BASE_PATH, serverAdapter.getRouter());
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', () => {
        this.logger.info(`Queue dashboard: http://127.0.0.1:${this.port}${BASE_PATH}`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }
}
