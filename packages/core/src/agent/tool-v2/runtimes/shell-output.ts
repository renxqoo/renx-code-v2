import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import stripAnsi from 'strip-ansi';

export interface ShellOutputArtifact {
  readonly runId: string;
  readonly runDir: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly combinedPath: string;
  readonly metaPath: string;
  readonly bytesStdout: number;
  readonly bytesStderr: number;
  readonly bytesCombined: number;
  readonly truncated: boolean;
  readonly previewChars: number;
}

export interface ShellOutputPreview {
  readonly output: string;
  readonly truncated: boolean;
  readonly totalChars: number;
}

export interface ShellOutputCaptureResult extends ShellOutputPreview {
  readonly artifact: ShellOutputArtifact;
}

interface ShellOutputCaptureOptions {
  readonly baseDir: string;
  readonly command: string;
  readonly cwd: string;
  readonly previewChars: number;
  readonly now?: () => number;
}

interface ShellOutputCaptureMeta {
  readonly runId: string;
  readonly command: string;
  readonly cwd: string;
  readonly createdAt: number;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly combinedPath: string;
  readonly bytesStdout: number;
  readonly bytesStderr: number;
  readonly bytesCombined: number;
  readonly previewChars: number;
  readonly truncated: boolean;
  readonly totalChars: number;
}

const DEFAULT_PREVIEW_CHARS = 16000;
const MIN_PREVIEW_CHARS = 256;

type ShellStreamSanitizerMode = 'text' | 'escape' | 'csi' | 'osc' | 'dcs' | 'pm' | 'apc' | 'sos';

type ShellStreamSanitizerState = {
  mode: ShellStreamSanitizerMode;
  awaitingStringTerminator: boolean;
};

const createShellStreamSanitizerState = (): ShellStreamSanitizerState => ({
  mode: 'text',
  awaitingStringTerminator: false,
});

const stripShellControlSequences = (input: string, state: ShellStreamSanitizerState): string => {
  if (!input) {
    return input;
  }

  let plainText = '';

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const code = input.charCodeAt(index);

    if (!char || Number.isNaN(code)) {
      continue;
    }

    if (state.mode === 'text') {
      if (char === '\u001b') {
        state.mode = 'escape';
        state.awaitingStringTerminator = false;
        continue;
      }
      if (code === 0x9b) {
        state.mode = 'csi';
        state.awaitingStringTerminator = false;
        continue;
      }
      plainText += char;
      continue;
    }

    if (state.mode === 'escape') {
      if (char === '[') {
        state.mode = 'csi';
      } else if (char === ']') {
        state.mode = 'osc';
        state.awaitingStringTerminator = false;
      } else if (char === 'P') {
        state.mode = 'dcs';
        state.awaitingStringTerminator = false;
      } else if (char === '^') {
        state.mode = 'pm';
        state.awaitingStringTerminator = false;
      } else if (char === '_') {
        state.mode = 'apc';
        state.awaitingStringTerminator = false;
      } else if (char === 'X') {
        state.mode = 'sos';
        state.awaitingStringTerminator = false;
      } else {
        state.mode = 'text';
        state.awaitingStringTerminator = false;
      }
      continue;
    }

    if (state.mode === 'csi') {
      if (code >= 0x40 && code <= 0x7e) {
        state.mode = 'text';
        state.awaitingStringTerminator = false;
      }
      continue;
    }

    if (state.awaitingStringTerminator) {
      if (char === '\\') {
        state.mode = 'text';
        state.awaitingStringTerminator = false;
        continue;
      }
      state.awaitingStringTerminator = false;
    }

    if (code === 0x07 || code === 0x9c) {
      state.mode = 'text';
      continue;
    }

    if (char === '\u001b') {
      state.awaitingStringTerminator = true;
    }
  }

  return plainText;
};

const stripUnsupportedShellControlChars = (value: string): string => {
  if (!value) {
    return value;
  }

  let normalized = '';

  for (const char of value) {
    const code = char.charCodeAt(0);
    const isAllowedWhitespace = code === 0x09 || code === 0x0a;
    const isPrintableAscii = code >= 0x20 && code <= 0x7e;
    const isNonAscii = code >= 0x80;

    if (isAllowedWhitespace || isPrintableAscii || isNonAscii) {
      normalized += char;
    }
  }

  return normalized;
};

export const sanitizeShellStreamChunk = (
  chunk: string,
  state?: ShellStreamSanitizerState
): string => {
  if (!chunk) {
    return chunk;
  }

  const sanitizerState = state ?? createShellStreamSanitizerState();

  let sanitized = stripShellControlSequences(chunk, sanitizerState);
  sanitized = stripAnsi(sanitized);
  sanitized = sanitized.replace(/\uFFFD/g, '');
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  sanitized = stripUnsupportedShellControlChars(sanitized);

  return sanitized;
};

const sanitizeShellPreviewOutput = (output: string): string => {
  if (!output) {
    return output;
  }

  const state = createShellStreamSanitizerState();
  let sanitized = sanitizeShellStreamChunk(output, state);
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
  return sanitized.trim();
};

export function truncateShellOutput(
  value: string,
  maxChars = DEFAULT_PREVIEW_CHARS
): ShellOutputPreview {
  const normalizedMaxChars = normalizePreviewChars(maxChars);
  if (value.length <= normalizedMaxChars) {
    return {
      output: sanitizeShellPreviewOutput(value),
      truncated: false,
      totalChars: value.length,
    };
  }

  const preview = buildTruncatedShellOutput({
    head: value.slice(0, Math.ceil(normalizedMaxChars / 2)),
    tail: value.slice(-(Math.floor(normalizedMaxChars / 2) || normalizedMaxChars)),
    totalChars: value.length,
    maxChars: normalizedMaxChars,
  });

  return {
    ...preview,
    output: sanitizeShellPreviewOutput(preview.output),
  };
}

export class ShellOutputCapture {
  private readonly preview: RollingShellOutputPreview;
  private readonly runId: string;
  private readonly runDir: string;
  private readonly stdoutPath: string;
  private readonly stderrPath: string;
  private readonly combinedPath: string;
  private readonly metaPath: string;
  private readonly stdoutStream: fs.WriteStream;
  private readonly stderrStream: fs.WriteStream;
  private readonly combinedStream: fs.WriteStream;
  private readonly command: string;
  private readonly cwd: string;
  private readonly createdAt: number;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private combinedBytes = 0;

  private constructor(options: ShellOutputCaptureOptions & { runId: string; runDir: string }) {
    this.preview = new RollingShellOutputPreview(options.previewChars);
    this.runId = options.runId;
    this.runDir = options.runDir;
    this.stdoutPath = path.join(this.runDir, 'stdout.log');
    this.stderrPath = path.join(this.runDir, 'stderr.log');
    this.combinedPath = path.join(this.runDir, 'combined.log');
    this.metaPath = path.join(this.runDir, 'meta.json');
    this.stdoutStream = fs.createWriteStream(this.stdoutPath, { encoding: 'utf8' });
    this.stderrStream = fs.createWriteStream(this.stderrPath, { encoding: 'utf8' });
    this.combinedStream = fs.createWriteStream(this.combinedPath, { encoding: 'utf8' });
    this.command = options.command;
    this.cwd = options.cwd;
    this.createdAt = (options.now || Date.now)();
  }

  static async create(options: ShellOutputCaptureOptions): Promise<ShellOutputCapture> {
    const runId = `run_${(options.now || Date.now)()}_${randomUUID().slice(0, 8)}`;
    const runDir = path.join(path.resolve(options.baseDir), runId);
    await fsp.mkdir(runDir, { recursive: true });
    return new ShellOutputCapture({
      ...options,
      previewChars: normalizePreviewChars(options.previewChars),
      runId,
      runDir,
    });
  }

  appendStdout(chunk: string): void {
    this.stdoutBytes += Buffer.byteLength(chunk, 'utf8');
    this.appendCombined(chunk);
    this.stdoutStream.write(chunk);
  }

  appendStderr(chunk: string): void {
    this.stderrBytes += Buffer.byteLength(chunk, 'utf8');
    this.appendCombined(chunk);
    this.stderrStream.write(chunk);
  }

  async finalize(params: {
    exitCode: number;
    timedOut: boolean;
  }): Promise<ShellOutputCaptureResult> {
    await Promise.all([
      closeStream(this.stdoutStream),
      closeStream(this.stderrStream),
      closeStream(this.combinedStream),
    ]);

    const preview = this.preview.finish();
    const artifact: ShellOutputArtifact = {
      runId: this.runId,
      runDir: this.runDir,
      stdoutPath: this.stdoutPath,
      stderrPath: this.stderrPath,
      combinedPath: this.combinedPath,
      metaPath: this.metaPath,
      bytesStdout: this.stdoutBytes,
      bytesStderr: this.stderrBytes,
      bytesCombined: this.combinedBytes,
      truncated: preview.truncated,
      previewChars: this.preview.maxChars,
    };

    const meta: ShellOutputCaptureMeta = {
      runId: this.runId,
      command: this.command,
      cwd: this.cwd,
      createdAt: this.createdAt,
      exitCode: params.exitCode,
      timedOut: params.timedOut,
      stdoutPath: this.stdoutPath,
      stderrPath: this.stderrPath,
      combinedPath: this.combinedPath,
      bytesStdout: this.stdoutBytes,
      bytesStderr: this.stderrBytes,
      bytesCombined: this.combinedBytes,
      previewChars: this.preview.maxChars,
      truncated: preview.truncated,
      totalChars: preview.totalChars,
    };
    await fsp.writeFile(this.metaPath, JSON.stringify(meta, null, 2), 'utf8');

    return {
      ...preview,
      artifact,
    };
  }

  private appendCombined(chunk: string): void {
    this.combinedBytes += Buffer.byteLength(chunk, 'utf8');
    this.preview.append(chunk);
    this.combinedStream.write(chunk);
  }
}

class RollingShellOutputPreview {
  readonly maxChars: number;
  private readonly headChars: number;
  private readonly tailChars: number;
  private fullText = '';
  private truncated = false;
  private head = '';
  private tail = '';
  private totalChars = 0;

  constructor(maxChars: number) {
    this.maxChars = normalizePreviewChars(maxChars);
    this.headChars = Math.ceil(this.maxChars / 2);
    this.tailChars = Math.floor(this.maxChars / 2);
  }

  append(chunk: string): void {
    if (!chunk) {
      return;
    }

    this.totalChars += chunk.length;

    if (!this.truncated) {
      const next = this.fullText + chunk;
      if (next.length <= this.maxChars) {
        this.fullText = next;
      } else {
        this.fullText = '';
        this.truncated = true;
      }
    }

    if (this.head.length < this.headChars) {
      const remaining = this.headChars - this.head.length;
      this.head += chunk.slice(0, remaining);
    }

    if (this.tailChars > 0) {
      this.tail = `${this.tail}${chunk}`.slice(-this.tailChars);
    }
  }

  finish(): ShellOutputPreview {
    if (!this.truncated) {
      return {
        output: sanitizeShellPreviewOutput(this.fullText),
        truncated: false,
        totalChars: this.totalChars,
      };
    }

    const preview = buildTruncatedShellOutput({
      head: this.head,
      tail: this.tail,
      totalChars: this.totalChars,
      maxChars: this.maxChars,
    });

    return {
      ...preview,
      output: sanitizeShellPreviewOutput(preview.output),
    };
  }
}

function buildTruncatedShellOutput(input: {
  head: string;
  tail: string;
  totalChars: number;
  maxChars: number;
}): ShellOutputPreview {
  const omittedChars = Math.max(0, input.totalChars - input.head.length - input.tail.length);
  const marker = `\n... [${omittedChars} chars truncated] ...\n`;
  return {
    output: `${input.head}${marker}${input.tail}`.trim(),
    truncated: true,
    totalChars: input.totalChars,
  };
}

function normalizePreviewChars(value: number): number {
  return Math.max(MIN_PREVIEW_CHARS, Math.floor(value || DEFAULT_PREVIEW_CHARS));
}

function closeStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener('error', onError);
      stream.removeListener('finish', onFinish);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onFinish = () => {
      cleanup();
      resolve();
    };
    stream.once('error', onError);
    stream.once('finish', onFinish);
    stream.end();
  });
}
