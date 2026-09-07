import fs from 'node:fs/promises';
import path from 'node:path';
import type { InboundAttachment } from '../types.js';
import type { Logger } from '../logger/Logger.js';

// Scratch directory created inside the *project's own* cwd — not a system
// temp dir — so every agent CLI can read it regardless of its own sandboxing
// model (Codex's workspace-write sandbox, for one, only grants broad access
// inside the directory it was launched in).
const ATTACHMENTS_DIR_NAME = '.agent-connect-attachments';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface DownloadedAttachment {
  /** The name the user's platform gave the file, for display only. */
  originalFilename: string;
  /** Path relative to `cwd`, safe to reference directly in a prompt. */
  relativePath: string;
}

function attachmentsDir(cwd: string, jobId: string): string {
  return path.join(cwd, ATTACHMENTS_DIR_NAME, jobId);
}

/** Strips path separators so a platform-supplied filename can never escape the destination directory. */
function sanitizeFilename(name: string | undefined, index: number): string {
  const base = (name ?? '').replace(/[/\\]/g, '_').trim();
  return base || `attachment-${index}`;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment too large (${contentLength} bytes, max ${MAX_ATTACHMENT_BYTES})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `attachment too large (${bytes.byteLength} bytes, max ${MAX_ATTACHMENT_BYTES})`,
    );
  }
  return bytes;
}

/**
 * Downloads inbound attachments (Telegram/Discord file uploads) into a
 * scratch directory inside the active project's cwd, so any agent CLI can
 * read them via its own normal file tools — none of the four supported CLIs
 * have a consistent, verified "attach an arbitrary remote file" flag, but
 * every one of them can read a file that already exists inside the project
 * it's operating on. Best-effort per attachment: one failure (bad URL, too
 * large, network error) is logged and skipped rather than failing the whole
 * execution.
 */
export async function downloadAttachments(
  attachments: InboundAttachment[] | undefined,
  cwd: string,
  jobId: string,
  logger: Logger,
): Promise<DownloadedAttachment[]> {
  if (!attachments || attachments.length === 0) return [];

  const destDir = attachmentsDir(cwd, jobId);
  const downloaded: DownloadedAttachment[] = [];

  for (const [index, attachment] of attachments.entries()) {
    const label = attachment.filename ?? `attachment ${index}`;
    if (!attachment.data && !attachment.url) continue;

    try {
      const bytes = attachment.data ?? (await fetchBytes(attachment.url!));
      await fs.mkdir(destDir, { recursive: true });
      const filename = sanitizeFilename(attachment.filename, index);
      const destPath = path.join(destDir, filename);
      await fs.writeFile(destPath, bytes);
      downloaded.push({ originalFilename: label, relativePath: path.relative(cwd, destPath) });
    } catch (error) {
      logger.warn(`Failed to download attachment "${label}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return downloaded;
}

/** Best-effort cleanup — never lets a cleanup failure surface as an execution error. */
export async function cleanupAttachments(
  cwd: string,
  jobId: string,
  logger: Logger,
): Promise<void> {
  try {
    await fs.rm(attachmentsDir(cwd, jobId), { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to clean up downloaded attachments', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Renders a note describing downloaded attachments, appended to the prompt sent to the agent (never to the user-facing header/progress text). */
export function describeAttachmentsForPrompt(downloaded: DownloadedAttachment[]): string {
  if (downloaded.length === 0) return '';
  const lines = downloaded.map((a) => `- ${a.relativePath} (originally "${a.originalFilename}")`);
  return `\n\n[Attached file(s) — read them from disk if relevant to the request]\n${lines.join('\n')}`;
}
