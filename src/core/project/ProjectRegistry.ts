import fs from 'node:fs';
import type { Logger } from '../logger/Logger.js';

/**
 * Loads and validates the project registry (name -> absolute repo path) from
 * a JSON file. Project selection is an exact-key allowlist lookup — the
 * path-traversal defense: a project name is never concatenated or joined
 * into a filesystem path, only used to select a key from this trusted map.
 */
export class ProjectRegistry {
  private registry: Record<string, string> = {};

  constructor(
    private readonly configPath: string,
    private readonly logger: Logger,
  ) {}

  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.configPath, 'utf8');
    } catch (error) {
      this.logger.warn(
        `Project registry not found at ${this.configPath} (${(error as Error).message}). ` +
          'No projects will be available until it is created.',
      );
      this.registry = {};
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.logger.error(
        `Failed to parse project registry at ${this.configPath}: ${(error as Error).message}`,
      );
      this.registry = {};
      return;
    }

    const validated: Record<string, string> = {};
    for (const [name, projectPath] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof projectPath !== 'string' || !fs.existsSync(projectPath)) {
        this.logger.warn(
          `Project registry entry "${name}" points to a path that does not exist: ${String(projectPath)}`,
        );
        continue;
      }
      validated[name] = projectPath;
    }
    this.registry = validated;
  }

  getPath(name: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(this.registry, name)
      ? this.registry[name]
      : undefined;
  }

  isValid(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.registry, name);
  }

  listNames(): string[] {
    return Object.keys(this.registry);
  }
}
