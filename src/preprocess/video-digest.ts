/**
 * Video digest pipeline: download → extract audio → transcribe → LLM summarize
 * Supports bilibili, YouTube, and any yt-dlp-compatible source.
 */
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { audioToMarkdown } from './audio-to-markdown.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const POLARPRIVATE_URL = process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790';
const DEFAULT_MODEL = '0010';

const YTDLP_BASE_ARGS = ['--cookies-from-browser', 'chrome'];

export type DownloadStrategy = 'subtitle_only' | 'audio_asr' | 'full_video' | 'auto';
export type MediaStatus = 'pending' | 'subtitle_fetched' | 'audio_extracted' | 'asr_done' | 'downloaded' | 'failed';

export interface VideoDigestOptions {
  outputDir?: string;
  language?: string;
  whisperModel?: string;
  skipDownload?: boolean;
  skipSummary?: boolean;
  forceAsr?: boolean;
  downloadStrategy?: DownloadStrategy;
}

export interface VideoDigestResult {
  title: string;
  videoPath: string;
  transcriptPath: string | null;
  summaryPath: string | null;
  transcript: string;
  summary: string;
  durationSeconds: number;
  method: 'subtitle' | 'whisper' | 'none';
  mediaStatus: MediaStatus;
}

export async function digestVideo(
  urlOrPath: string,
  options: VideoDigestOptions = {},
): Promise<VideoDigestResult> {
  const outDir = options.outputDir || './data/video-digests';
  mkdirSync(outDir, { recursive: true });

  const strategy = options.downloadStrategy ?? 'auto';
  let videoPath = urlOrPath;
  let title = basename(urlOrPath, extname(urlOrPath));
  let mediaStatus: MediaStatus = 'pending';

  const isUrl = urlOrPath.startsWith('http');

  // Phase 1: Try subtitle-only extraction (no video download)
  if (isUrl && strategy !== 'full_video') {
    console.log(`[VideoDigest] Phase 1: subtitle-only fetch for ${urlOrPath}`);
    const subResult = await fetchSubtitleOnly(urlOrPath, outDir);
    if (subResult) {
      title = subResult.title;
      videoPath = subResult.videoPath || urlOrPath;
      const transcript = subResult.transcript;
      mediaStatus = 'subtitle_fetched';

      if (transcript) {
        console.log(`[VideoDigest] Subtitle extracted (${transcript.length} chars)`);
        return await finalize(title, videoPath, transcript, 'subtitle', mediaStatus, outDir, options);
      }
    }
  }

  // Phase 2: Audio-only ASR (if subtitle failed and strategy allows)
  if (isUrl && (strategy === 'audio_asr' || strategy === 'auto')) {
    console.log(`[VideoDigest] Phase 2: audio extraction + ASR`);
    const audioResult = await fetchAudioForAsr(urlOrPath, outDir);
    if (audioResult?.audioPath && existsSync(audioResult.audioPath)) {
      title = audioResult.title || title;
      mediaStatus = 'audio_extracted';

      const result = await audioToMarkdown(audioResult.audioPath, {
        model: options.whisperModel || 'Qwen/Qwen3-ASR-0.6B',
        language: options.language || 'Chinese',
        outputDir: outDir,
      });
      if (result.success && result.markdown) {
        mediaStatus = 'asr_done';
        return await finalize(title, audioResult.audioPath, result.markdown, 'whisper', mediaStatus, outDir, options);
      }
    }
  }

  // Phase 3: Full video download (if strategy allows)
  if (isUrl && (strategy === 'full_video' || strategy === 'auto')) {
    console.log(`[VideoDigest] Phase 3: full video download`);
    const dlResult = await downloadWithSubtitles(urlOrPath, outDir);
    videoPath = dlResult.videoPath;
    title = dlResult.title;
    mediaStatus = 'downloaded';
  } else if (isUrl && strategy === 'subtitle_only') {
    mediaStatus = 'failed';
    return { title, videoPath, transcriptPath: null, summaryPath: null, transcript: '', summary: '', durationSeconds: 0, method: 'none', mediaStatus };
  }

  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  let transcript = '';
  let method: 'subtitle' | 'whisper' | 'none' = 'none';

  const subFile = findSubtitleFile(videoPath, outDir);
  if (subFile) {
    console.log(`[VideoDigest] Found subtitle: ${subFile}`);
    transcript = parseSubtitle(readFileSync(subFile, 'utf-8'));
    method = 'subtitle';
    if (mediaStatus === 'downloaded') mediaStatus = 'downloaded';
  }

  if (!transcript && (options.forceAsr || strategy === 'auto' || strategy === 'full_video')) {
    console.log(`[VideoDigest] No subtitle, running ASR...`);
    const audioPath = join(outDir, `${sanitize(title)}.wav`);
    await extractAudio(videoPath, audioPath);

    if (existsSync(audioPath)) {
      const result = await audioToMarkdown(audioPath, {
        model: options.whisperModel || 'Qwen/Qwen3-ASR-0.6B',
        language: options.language || 'Chinese',
        outputDir: outDir,
      });
      if (result.success) {
        transcript = result.markdown;
        method = 'whisper';
      }
    }
  }

  return await finalize(title, videoPath, transcript, method, mediaStatus, outDir, options);
}

async function finalize(
  title: string,
  videoPath: string,
  transcript: string,
  method: 'subtitle' | 'whisper' | 'none',
  mediaStatus: MediaStatus,
  outDir: string,
  options: VideoDigestOptions,
): Promise<VideoDigestResult> {
  const transcriptPath = transcript
    ? join(outDir, `${sanitize(title)}.transcript.md`)
    : null;
  if (transcriptPath && transcript) {
    writeFileSync(transcriptPath, `# ${title}\n\n${transcript}`);
    console.log(`[VideoDigest] Transcript saved: ${transcriptPath}`);
  }

  let summary = '';
  let summaryPath: string | null = null;
  if (transcript && !options.skipSummary) {
    summary = await summarizeTranscript(title, transcript);
    if (summary) {
      summaryPath = join(outDir, `${sanitize(title)}.summary.md`);
      writeFileSync(summaryPath, summary);
      console.log(`[VideoDigest] Summary saved: ${summaryPath}`);
    }
  }

  const duration = existsSync(videoPath) ? await getVideoDuration(videoPath) : 0;

  return { title, videoPath, transcriptPath, summaryPath, transcript, summary, durationSeconds: duration, method, mediaStatus };
}

async function fetchSubtitleOnly(
  url: string,
  outDir: string,
): Promise<{ title: string; transcript: string; videoPath: string | null } | null> {
  try {
    const args = [
      ...YTDLP_BASE_ARGS,
      '--skip-download',
      '--write-subs', '--write-auto-subs',
      '--sub-langs', 'zh-Hans,zh-Hant,zh,en',
      '--convert-subs', 'srt',
      '-o', join(outDir, '%(title).80s [%(id)s].%(ext)s'),
      '--no-playlist',
      url,
    ];
    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 60_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const titleMatch = stdout.match(/\[info\] (.+?):/);
    const title = titleMatch?.[1] || 'unknown';

    const srtFiles = readdirSync(outDir).filter(f => f.endsWith('.srt')).sort((a, b) => {
      const { statSync } = require('node:fs');
      return statSync(join(outDir, b)).mtimeMs - statSync(join(outDir, a)).mtimeMs;
    });

    if (srtFiles.length > 0) {
      const srtPath = join(outDir, srtFiles[0]);
      const transcript = parseSubtitle(readFileSync(srtPath, 'utf-8'));
      if (transcript.length > 50) {
        return { title, transcript, videoPath: null };
      }
    }

    return { title, transcript: '', videoPath: null };
  } catch (err: any) {
    console.error(`[VideoDigest] Subtitle-only fetch failed: ${err.message}`);
    return null;
  }
}

async function fetchAudioForAsr(
  url: string,
  outDir: string,
): Promise<{ audioPath: string; title: string } | null> {
  try {
    const args = [
      ...YTDLP_BASE_ARGS,
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'wav',
      '--postprocessor-args', 'ffmpeg:-ar 16000 -ac 1',
      '-o', join(outDir, '%(title).80s [%(id)s].%(ext)s'),
      '--no-playlist',
      '--no-overwrites',
      url,
    ];
    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const wavFiles = readdirSync(outDir).filter(f => f.endsWith('.wav')).sort((a, b) => {
      const { statSync } = require('node:fs');
      return statSync(join(outDir, b)).mtimeMs - statSync(join(outDir, a)).mtimeMs;
    });

    if (wavFiles.length > 0) {
      const audioPath = join(outDir, wavFiles[0]);
      const title = basename(wavFiles[0], '.wav');
      return { audioPath, title };
    }
    return null;
  } catch (err: any) {
    console.error(`[VideoDigest] Audio extraction failed: ${err.message}`);
    return null;
  }
}

async function downloadWithSubtitles(
  url: string,
  outDir: string,
): Promise<{ videoPath: string; title: string }> {
  const args = [
    ...YTDLP_BASE_ARGS,
    '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
    '--merge-output-format', 'mp4',
    '-o', join(outDir, '%(title).80s [%(id)s].%(ext)s'),
    '--write-subs', '--write-auto-subs',
    '--sub-langs', 'zh-Hans,zh-Hant,zh,en',
    '--convert-subs', 'srt',
    '--no-playlist',
    '--no-overwrites',
    url,
  ];

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const destMatch = stdout.match(/Destination: (.+\.mp4)/);
    const mergeMatch = stdout.match(/\[Merger\] Merging formats into "([^"]+)"/);
    const alreadyMatch = stdout.match(/\[download\] (.+\.mp4) has already been downloaded/);

    const videoPath = mergeMatch?.[1] || destMatch?.[1] || alreadyMatch?.[1] || '';
    const titleMatch = stdout.match(/\[download\] Downloading video (?:\d+ of \d+|1 of 1)\n.*?Destination: .+[/\\](.+) \[/);
    const title = videoPath ? basename(videoPath, extname(videoPath)) : 'unknown';

    if (videoPath && existsSync(videoPath)) {
      return { videoPath, title };
    }

    const { statSync } = await import('node:fs');
    const mp4s = readdirSync(outDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({ name: f, mtime: statSync(join(outDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (mp4s.length > 0) {
      const vp = join(outDir, mp4s[0].name);
      return { videoPath: vp, title: basename(mp4s[0].name, '.mp4') };
    }

    throw new Error('Download completed but video file not found');
  } catch (err: any) {
    throw new Error(`Download failed: ${err.message || err}`);
  }
}

function findSubtitleFile(videoPath: string, dir: string): string | null {
  const base = basename(videoPath, extname(videoPath));
  const candidates = [
    videoPath.replace(/\.mp4$/, '.zh-Hans.srt'),
    videoPath.replace(/\.mp4$/, '.zh-Hant.srt'),
    videoPath.replace(/\.mp4$/, '.zh.srt'),
    videoPath.replace(/\.mp4$/, '.en.srt'),
    videoPath.replace(/\.mp4$/, '.srt'),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  const srtFiles = readdirSync(dir).filter(f => f.endsWith('.srt') && f.includes(base.slice(0, 30)));
  if (srtFiles.length > 0) return join(dir, srtFiles[0]);

  return null;
}

function parseSubtitle(srt: string): string {
  const blocks = srt.split(/\n\n+/);
  const lines: string[] = [];

  for (const block of blocks) {
    const parts = block.trim().split('\n');
    if (parts.length >= 3) {
      const text = parts.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
      if (text) lines.push(text);
    } else if (parts.length === 1 && parts[0].trim().length > 0 && !/^\d+$/.test(parts[0].trim())) {
      lines.push(parts[0].trim());
    }
  }

  const deduped = lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
  return deduped.join('\n');
}

async function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  if (existsSync(audioPath)) return;
  try {
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vn', '-acodec', 'pcm_s16le',
      '-ar', '16000', '-ac', '1',
      '-y', audioPath,
    ], { timeout: 120_000 });
    console.log(`[VideoDigest] Audio extracted: ${audioPath}`);
  } catch (err: any) {
    console.error(`[VideoDigest] Audio extraction failed: ${err.message}`);
  }
}

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
    ], { timeout: 10_000 });
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function summarizeTranscript(title: string, transcript: string): Promise<string> {
  const truncated = transcript.slice(0, 8000);

  const prompt = `你是一个视频内容分析师。请根据以下视频转录文本，生成一份结构化的中文摘要。

视频标题: ${title}

## 要求
1. **核心观点** (3-5 个要点)
2. **关键信息** (数据、人名、工具名等)
3. **一句话总结**
4. **适合人群**

## 转录文本
${truncated}`;

  try {
    const resp = await fetch(`${POLARPRIVATE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      console.error(`[VideoDigest] LLM error: ${resp.status}`);
      return '';
    }

    const data = await resp.json() as any;
    const summary = data.choices?.[0]?.message?.content || '';
    return `# 视频摘要: ${title}\n\n${summary}`;
  } catch (err: any) {
    console.error(`[VideoDigest] Summary failed: ${err.message}`);
    return '';
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 60);
}
