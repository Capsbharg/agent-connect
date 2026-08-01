import type { Plugin, PluginContext } from './Plugin.js';

export class PluginManager {
  constructor(private readonly plugins: Plugin[]) {}

  async registerAll(ctx: PluginContext): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.register(ctx);
    }
  }
}
