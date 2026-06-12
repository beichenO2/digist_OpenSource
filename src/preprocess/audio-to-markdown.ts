import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';

export interface TranscribeOptions {
  model?: string;
  language?: string;
  outputDir?: string;
}

export interface TranscribeResult {
  success: boolean;
  markdown: string;
  duration_seconds: number;
  method: string;
  error?: string;
}

export async function audioToMarkdown(
  audioPath: string,
  options: TranscribeOptions = {}
): Promise<TranscribeResult> {
  if (!existsSync(audioPath)) {
    return { success: false, markdown: '', duration_seconds: 0, method: 'none', error: `File not found: ${audioPath}` };
  }

  const methods = [
    tryQwen3AsrCli,
    tryQwen3AsrPython,
    trySubtitleExtract,
  ];

  for (const method of methods) {
    try {
      const result = await method(audioPath, options);
      if (result.success) return result;
    } catch {
      continue;
    }
  }

  return { success: false, markdown: '', duration_seconds: 0, method: 'all-failed', error: 'All transcription methods failed' };
}

async function tryQwen3AsrCli(audioPath: string, options: TranscribeOptions): Promise<TranscribeResult> {
  try {
    const model = options.model ?? 'Qwen/Qwen3-ASR-0.6B';
    const langFlag = options.language ? `--language ${options.language}` : '--language Chinese';
    const outDir = options.outputDir ?? '/tmp/digist-qwen3asr';
    mkdirSync(outDir, { recursive: true });

    const asrBin = process.env.QWEN3_ASR_BIN ?? 'mlx-qwen3-asr';
    execSync(
      `${asrBin} "${audioPath}" --model ${model} ${langFlag} -f json --timestamps -o "${outDir}"`,
      { timeout: 600000, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );

    const base = basename(audioPath, extname(audioPath));
    const jsonPath = join(outDir, `${base}.json`);
    if (!existsSync(jsonPath)) {
      return { success: false, markdown: '', duration_seconds: 0, method: 'qwen3-asr-cli', error: 'No output file' };
    }

    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const segments = data.segments ?? [];
    const text = data.text ?? '';
    const markdown = segments.length > 0
      ? formatSegments(segments, basename(audioPath))
      : formatTranscript(text, basename(audioPath));

    return {
      success: true,
      markdown,
      duration_seconds: segments.length > 0 ? segments[segments.length - 1].end : estimateDuration(audioPath),
      method: 'qwen3-asr-cli',
    };
  } catch (err) {
    return { success: false, markdown: '', duration_seconds: 0, method: 'qwen3-asr-cli', error: String(err) };
  }
}

async function tryQwen3AsrPython(audioPath: string, options: TranscribeOptions): Promise<TranscribeResult> {
  try {
    const model = options.model ?? 'Qwen/Qwen3-ASR-0.6B';
    const langArg = options.language ? `, language="${options.language}"` : '';

    const script = `
import json, sys
from mlx_qwen3_asr import transcribe
result = transcribe("${audioPath}", model="${model}"${langArg}, return_timestamps=True)
segs = result.segments or []
print(json.dumps({"text": result.text, "segments": [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in segs]}))
`;

    const venvPython = process.env.QWEN3_ASR_PYTHON ?? 'python3';
    const output = execSync(`${venvPython} -c '${script.replace(/'/g, "\\'")}'`, {
      timeout: 600000,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    const data = JSON.parse(output.trim());
    const segments = data.segments ?? [];
    const markdown = segments.length > 0
      ? formatSegments(segments, basename(audioPath))
      : formatTranscript(data.text ?? '', basename(audioPath));

    return {
      success: true,
      markdown,
      duration_seconds: segments.length > 0 ? segments[segments.length - 1].end : 0,
      method: 'qwen3-asr-python',
    };
  } catch (err) {
    return { success: false, markdown: '', duration_seconds: 0, method: 'qwen3-asr-python', error: String(err) };
  }
}

async function trySubtitleExtract(audioPath: string, _options: TranscribeOptions): Promise<TranscribeResult> {
  const ext = extname(audioPath).toLowerCase();
  const subtitleExts = ['.srt', '.vtt', '.txt'];
  const basePath = audioPath.slice(0, -ext.length);

  for (const sExt of subtitleExts) {
    const sPath = basePath + sExt;
    if (existsSync(sPath)) {
      const raw = readFileSync(sPath, 'utf-8');
      const markdown = parseSrtToMarkdown(raw, basename(audioPath));
      return { success: true, markdown, duration_seconds: 0, method: 'subtitle-file' };
    }
  }

  return { success: false, markdown: '', duration_seconds: 0, method: 'subtitle-extract', error: 'No subtitle file found' };
}

function formatTranscript(text: string, filename: string): string {
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  const watermark = '> ⚠️ **ASR 水印**：本转录由 Qwen3-ASR (MLX) 自动生成，ASR 结果不保证语意不变。后续处理 LLM 需要上下文梳理和事实核查、术语核查。\n';
  return `# Transcript: ${filename}\n\n${watermark}\n${paragraphs.map((p) => p.trim()).join('\n\n')}`;
}

function formatSegments(segments: { start: number; end: number; text: string }[], filename: string): string {
  const watermark = '> ⚠️ **ASR 水印**：本转录由 Qwen3-ASR (MLX) 自动生成，ASR 结果不保证语意不变。后续处理 LLM 需要上下文梳理和事实核查、术语核查。';
  const lines = segments.map((s) => {
    const startTs = formatTimestamp(s.start);
    return `**[${startTs}]** ${s.text.trim()}`;
  });
  return `# Transcript: ${filename}\n\n${watermark}\n\n${lines.join('\n\n')}`;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

function parseSrtToMarkdown(srt: string, filename: string): string {
  const blocks = srt.split(/\n\n+/);
  const lines: string[] = [];

  for (const block of blocks) {
    const parts = block.trim().split('\n');
    if (parts.length >= 3) {
      const timeStr = parts[1];
      const text = parts.slice(2).join(' ').replace(/<[^>]+>/g, '');
      const startMatch = timeStr.match(/(\d{2}):(\d{2}):(\d{2})/);
      if (startMatch) {
        const ts = `${parseInt(startMatch[1])}:${startMatch[2]}:${startMatch[3]}`;
        lines.push(`**[${ts}]** ${text}`);
      } else {
        lines.push(text);
      }
    } else if (parts.length >= 1 && parts[0].trim().length > 0) {
      lines.push(parts.join(' '));
    }
  }

  const asrWatermark = '> ⚠️ **ASR 水印**：本转录由 Qwen3-ASR (MLX) 自动生成，ASR 结果不保证语意不变。后续处理 LLM 需要上下文梳理和事实核查、术语核查。';
  return `# Transcript: ${filename}\n\n${asrWatermark}\n\n${lines.join('\n\n')}`;
}

function estimateDuration(filePath: string): number {
  try {
    const output = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}
