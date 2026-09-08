import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupAttachments,
  describeAttachmentsForPrompt,
  downloadAttachments,
} from '../../../src/core/execution/attachmentDownloader.js';
import { createTestLogger } from '../../helpers/testLogger.js';

function fakeResponse(
  body: ArrayBuffer,
  opts: { ok?: boolean; status?: number; contentLength?: string } = {},
) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: {
      get: (name: string) => (name === 'content-length' ? (opts.contentLength ?? null) : null),
    },
    arrayBuffer: async () => body,
  };
}

describe('downloadAttachments / cleanupAttachments', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-connect-attachments-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('returns [] for undefined/empty attachments without touching the filesystem', async () => {
    expect(await downloadAttachments(undefined, cwd, 'job-1', createTestLogger())).toEqual([]);
    expect(await downloadAttachments([], cwd, 'job-1', createTestLogger())).toEqual([]);
    expect(fs.existsSync(path.join(cwd, '.agent-connect-attachments'))).toBe(false);
  });

  it('downloads a URL attachment into <cwd>/.agent-connect-attachments/<jobId>/', async () => {
    const bytes = new TextEncoder().encode('hello world').buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(bytes)),
    );

    const downloaded = await downloadAttachments(
      [{ filename: 'notes.txt', url: 'https://example.com/notes.txt' }],
      cwd,
      'job-1',
      createTestLogger(),
    );

    expect(downloaded).toEqual([
      {
        originalFilename: 'notes.txt',
        relativePath: path.join('.agent-connect-attachments', 'job-1', 'notes.txt'),
      },
    ]);
    const written = fs.readFileSync(path.join(cwd, downloaded[0]!.relativePath), 'utf8');
    expect(written).toBe('hello world');
  });

  it('uses inline data when present instead of fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const downloaded = await downloadAttachments(
      [{ filename: 'inline.txt', data: Buffer.from('inline content') }],
      cwd,
      'job-1',
      createTestLogger(),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(cwd, downloaded[0]!.relativePath), 'utf8')).toBe(
      'inline content',
    );
  });

  it('sanitizes a filename containing path separators so it cannot escape the destination directory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(new ArrayBuffer(0))),
    );

    const downloaded = await downloadAttachments(
      [{ filename: '../../etc/passwd', url: 'https://example.com/x' }],
      cwd,
      'job-1',
      createTestLogger(),
    );

    // Stripping / and \ removes every path separator, so no matter what the
    // leftover characters look like, path.join can't resolve outside destDir
    // (there's nothing left to interpret as a directory boundary).
    const destDir = path.join(cwd, '.agent-connect-attachments', 'job-1');
    const resolved = path.resolve(cwd, downloaded[0]!.relativePath);
    expect(resolved.startsWith(destDir + path.sep)).toBe(true);
    expect(fs.readdirSync(destDir)).toHaveLength(1);
  });

  it('disambiguates two attachments that share the same filename instead of overwriting one', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++;
        return fakeResponse(new TextEncoder().encode(`content-${call}`).buffer);
      }),
    );

    const downloaded = await downloadAttachments(
      [
        { filename: 'image.png', url: 'https://example.com/a' },
        { filename: 'image.png', url: 'https://example.com/b' },
      ],
      cwd,
      'job-1',
      createTestLogger(),
    );

    expect(downloaded).toHaveLength(2);
    expect(downloaded[0]!.relativePath).not.toBe(downloaded[1]!.relativePath);
    expect(fs.readFileSync(path.join(cwd, downloaded[0]!.relativePath), 'utf8')).toBe('content-1');
    expect(fs.readFileSync(path.join(cwd, downloaded[1]!.relativePath), 'utf8')).toBe('content-2');
  });

  it('skips (logs, does not throw) an attachment with neither url nor data', async () => {
    const downloaded = await downloadAttachments(
      [{ filename: 'ghost.txt' }],
      cwd,
      'job-1',
      createTestLogger(),
    );
    expect(downloaded).toEqual([]);
  });

  it('skips an attachment when the fetch fails, logging a warning, without throwing', async () => {
    const logger = createTestLogger();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(new ArrayBuffer(0), { ok: false, status: 404 })),
    );

    const downloaded = await downloadAttachments(
      [{ filename: 'missing.txt', url: 'https://example.com/missing.txt' }],
      cwd,
      'job-1',
      logger,
    );

    expect(downloaded).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to download attachment "missing.txt"',
      expect.objectContaining({ error: expect.stringContaining('404') }),
    );
  });

  it('rejects an attachment declared larger than the size cap via content-length, without downloading the body', async () => {
    const logger = createTestLogger();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse(new ArrayBuffer(0), { contentLength: String(50 * 1024 * 1024) }),
      ),
    );

    const downloaded = await downloadAttachments(
      [{ filename: 'huge.bin', url: 'https://example.com/huge.bin' }],
      cwd,
      'job-1',
      logger,
    );

    expect(downloaded).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to download attachment "huge.bin"',
      expect.objectContaining({ error: expect.stringContaining('too large') }),
    );
  });

  it('continues downloading remaining attachments after one fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++;
        return call === 1
          ? fakeResponse(new ArrayBuffer(0), { ok: false, status: 500 })
          : fakeResponse(new TextEncoder().encode('ok').buffer);
      }),
    );

    const downloaded = await downloadAttachments(
      [
        { filename: 'fails.txt', url: 'https://example.com/fails.txt' },
        { filename: 'works.txt', url: 'https://example.com/works.txt' },
      ],
      cwd,
      'job-1',
      createTestLogger(),
    );

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]!.originalFilename).toBe('works.txt');
  });

  it('cleanupAttachments removes the job-specific scratch directory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(new TextEncoder().encode('x').buffer)),
    );
    await downloadAttachments(
      [{ filename: 'a.txt', url: 'https://example.com/a.txt' }],
      cwd,
      'job-1',
      createTestLogger(),
    );
    expect(fs.existsSync(path.join(cwd, '.agent-connect-attachments', 'job-1'))).toBe(true);

    await cleanupAttachments(cwd, 'job-1', createTestLogger());

    expect(fs.existsSync(path.join(cwd, '.agent-connect-attachments', 'job-1'))).toBe(false);
  });

  it('cleanupAttachments on a directory that never existed is a safe no-op', async () => {
    await expect(cleanupAttachments(cwd, 'never-ran', createTestLogger())).resolves.toBeUndefined();
  });
});

describe('describeAttachmentsForPrompt', () => {
  it('returns an empty string for no attachments', () => {
    expect(describeAttachmentsForPrompt([])).toBe('');
  });

  it('renders each attachment with its relative path and original filename', () => {
    const text = describeAttachmentsForPrompt([
      { originalFilename: 'notes.txt', relativePath: '.agent-connect-attachments/job-1/notes.txt' },
    ]);
    expect(text).toContain('.agent-connect-attachments/job-1/notes.txt');
    expect(text).toContain('notes.txt');
  });
});
