import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, basename, extname } from 'path';
import { audioToMarkdown, type TranscribeOptions } from './audio-to-markdown.js';
import { detectDomainFromContent, type ImageDomain } from './image-policy.js';
import { describeImage } from './vlm-caller.js';

export interface VideoConvertOptions extends TranscribeOptions {
  domain?: ImageDomain;
  frameInterval?: number;
  maxFrames?: number;
  skipFrames?: boolean;
}

export interface VideoConvertResult {
  success: boolean;
  markdown: string;
  duration_seconds: number;
  transcript_method: string;
  frames_extracted: number;
  frames_described: number;
  domain: ImageDomain;
  error?: string;
}

const FRAME_POLICY: Record<ImageDomain, { extract: boolean; vlm: boolean; interval: number }> = {
  medical:  { extract: true,  vlm: true,  interval: 10 },
  academic: { extract: true,  vlm: true,  interval: 15 },
  tech:     { extract: true,  vlm: true,  interval: 30 },
  finance:  { extract: false, vlm: false, interval: 0 },
  general:  { extract: false, vlm: false, interval: 0 },
};

export async function videoToMarkdown(
  videoPath: string,
  options: VideoConvertOptions = {},
): Promise<VideoConvertResult> {
  if (!existsSync(videoPath)) {
    return makeError('File not found: ' + videoPath);
  }

  const tmpDir = join(options.outputDir ?? '/tmp/digist-video', basename(videoPath, extname(videoPath)));
  mkdirSync(tmpDir, { recursive: true });

  const duration = getVideoDuration(videoPath);

  // Step 1: Extract audio track and transcribe
  const audioPath = join(tmpDir, 'audio.wav');
  let transcript = '';
  let transcriptMethod = 'none';

  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`,
      { timeout: 120_000, encoding: 'utf-8', stdio: 'pipe' },
    );

    if (existsSync(audioPath)) {
      const result = await audioToMarkdown(audioPath, options);
      if (result.success) {
        transcript = result.markdown;
        transcriptMethod = result.method;
      }
    }
  } catch { /* audio extraction failed, continue with frames */ }

  // Step 2: Determine frame extraction policy
  const domain = options.domain ?? detectDomainFromContent(transcript || basename(videoPath));
  const policy = FRAME_POLICY[domain];
  const shouldExtractFrames = options.skipFrames === true ? false : policy.extract;

  let frameDescriptions: string[] = [];
  let framesExtracted = 0;
  let framesDescribed = 0;

  if (shouldExtractFrames) {
    const interval = options.frameInterval ?? policy.interval;
    const maxFrames = options.maxFrames ?? 20;

    // Step 3: Extract keyframes
    const framesDir = join(tmpDir, 'frames');
    mkdirSync(framesDir, { recursive: true });

    try {
      execSync(
        `ffmpeg -y -i "${videoPath}" -vf "fps=1/${interval}" -frame_pts 1 -q:v 2 "${framesDir}/frame_%04d.jpg"`,
        { timeout: 300_000, encoding: 'utf-8', stdio: 'pipe' },
      );

      const frameFiles = readdirSync(framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .slice(0, maxFrames);

      framesExtracted = frameFiles.length;

      // Step 4: VLM describe frames (if policy says so)
      if (policy.vlm && frameFiles.length > 0) {
        for (const frameFile of frameFiles) {
          const framePath = join(framesDir, frameFile);
          const frameIdx = parseInt(frameFile.replace(/\D/g, '')) || 0;
          const timestamp = frameIdx * interval;
          const timeStr = formatTimestamp(timestamp);

          try {
            const vlmResult = await describeImage(
              framePath,
              `Video frame at ${timeStr} from ${basename(videoPath)}. Domain: ${domain}`,
            );
            if (vlmResult.description && vlmResult.method !== 'fallback') {
              frameDescriptions.push(`**[${timeStr}]** ${vlmResult.description.trim()}`);
              framesDescribed++;
            }
          } catch { /* skip failed frame */ }
        }
      }

      // Cleanup frame files
      for (const f of readdirSync(framesDir)) {
        try { unlinkSync(join(framesDir, f)); } catch {}
      }
    } catch { /* frame extraction failed */ }
  }

  // Cleanup audio
  try { if (existsSync(audioPath)) unlinkSync(audioPath); } catch {}

  // Build combined markdown
  const sections: string[] = [];
  sections.push(`# Video: ${basename(videoPath)}`);
  sections.push('');
  sections.push(`*Duration: ${formatTimestamp(duration)} | Domain: ${domain} | Frames: ${framesExtracted} extracted, ${framesDescribed} described*`);
  sections.push('');

  if (transcript) {
    sections.push('## Transcript');
    sections.push('');
    const transcriptBody = transcript.replace(/^# Transcript:.*\n\n?/, '');
    sections.push(transcriptBody);
    sections.push('');
  }

  if (frameDescriptions.length > 0) {
    sections.push('## Visual Content');
    sections.push('');
    sections.push(frameDescriptions.join('\n\n'));
    sections.push('');
  }

  const markdown = sections.join('\n');

  return {
    success: transcript.length > 0 || frameDescriptions.length > 0,
    markdown,
    duration_seconds: duration,
    transcript_method: transcriptMethod,
    frames_extracted: framesExtracted,
    frames_described: framesDescribed,
    domain,
  };
}

function getVideoDuration(videoPath: string): number {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf-8', timeout: 10_000 },
    );
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function makeError(msg: string): VideoConvertResult {
  return {
    success: false, markdown: '', duration_seconds: 0,
    transcript_method: 'none', frames_extracted: 0, frames_described: 0,
    domain: 'general', error: msg,
  };
}
