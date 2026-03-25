import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildImageDataUrl,
  buildImageUrlPart,
  buildPromptContent,
  inferImageMimeType,
} from './attachment-content';

const capabilities = {
  image: false,
  audio: false,
  video: false,
};

describe('buildPromptContent', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  it('inlines plain text attachments', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'renx-attachment-text-'));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, 'notes.txt');
    await writeFile(filePath, 'hello from notes');

    const content = await buildPromptContent(
      'summarize this',
      [
        {
          relativePath: 'notes.txt',
          absolutePath: filePath,
          size: 16,
        },
      ],
      capabilities
    );

    expect(content).toEqual([
      {
        type: 'text',
        text: 'summarize this',
      },
      {
        type: 'text',
        text: 'Attached file: notes.txt\n\n```\nhello from notes\n```',
      },
    ]);
  });

  it('builds image data urls and image_url parts with shared helpers', () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

    expect(inferImageMimeType('diagram.png')).toBe('image/png');
    expect(buildImageDataUrl('diagram.png', bytes)).toBe('data:image/png;base64,iVBORw==');
    expect(buildImageUrlPart('diagram.png', bytes)).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,iVBORw==',
        detail: 'auto',
      },
    });
  });

  it('does not inline binary attachments as decoded gibberish', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'renx-attachment-bin-'));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, 'paper.docx');
    await writeFile(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]));

    const content = await buildPromptContent(
      'analyze this file',
      [
        {
          relativePath: 'paper.docx',
          absolutePath: filePath,
          size: 8,
        },
      ],
      capabilities
    );

    expect(content).toEqual([
      {
        type: 'text',
        text: 'analyze this file',
      },
      {
        type: 'text',
        text: 'Attached file: paper.docx\n\n[binary attachment omitted from prompt text]',
      },
    ]);
  });
});
