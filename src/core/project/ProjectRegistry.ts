import fs from 'node:fs';
import type { Logger } from '../logger/Logger.js';

export interface ProjectEntry {
  path: string;
  /** Default agent for this project, overriding DEFAULT_AGENT — a user's own `agent <name>` selection still wins. */
  agent?: string;
  /** Default model for this project, passed to whichever agent runs as `--model`/`-m`. */
  model?: string;
}

function normalizeEntry(raw: unknown): ProjectEntry | null {
  if (typeof raw === 'string') return { path: raw };
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.path !== 'string') return null;
    return {
      path: obj.path,
      agent: typeof obj.agent === 'string' ? obj.agent : undefined,
      model: typeof obj.model === 'string' ? obj.model : undefined,
    };
  }
  return null;
}

/**
 * Loads and validates the project registry from a JSON file. Each entry is
 * either a plain absolute path string (the original, still-supported shape)
 * or an object `{ path, agent?, model? }` for a project that should default
 * to a specific agent/model instead of the app-wide DEFAULT_AGENT. Project
 * selection is an exact-key allowlist lookup — the path-traversal defense: a
 * project name is never concatenated or joined into a filesystem path, only
 * used to select a key from this trusted map.
 */
export class ProjectRegistry {
  private registry: Record<string, ProjectEntry> = {};

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

    const validated: Record<string, ProjectEntry> = {};
    for (const [name, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = normalizeEntry(rawEntry);
      if (!entry || !fs.existsSync(entry.path)) {
        this.logger.warn(
          `Project registry entry "${name}" points to a path that does not exist: ${entry ? entry.path : String(rawEntry)}`,
        );
        continue;
      }
      validated[name] = entry;
    }
    this.registry = validated;
  }

  private entry(name: string): ProjectEntry | undefined {
    return Object.prototype.hasOwnProperty.call(this.registry, name)
      ? this.registry[name]
      : undefined;
  }

  getPath(name: string): string | undefined {
    return this.entry(name)?.path;
  }

  /** The project's default agent, if one is configured — a user's own `agent <name>` selection still takes priority. */
  getAgentOverride(name: string): string | undefined {
    return this.entry(name)?.agent;
  }

  /** The project's default model, if one is configured — passed to whichever agent runs. */
  getModelOverride(name: string): string | undefined {
    return this.entry(name)?.model;
  }

  isValid(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.registry, name);
  }

  listNames(): string[] {
    return Object.keys(this.registry);
  }
}
