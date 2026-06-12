/**
 * Push high-quality video digests to KnowLever's raw/ directory.
 * KnowLever dynamically compiles from raw/, so no notification needed.
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const KNOWLEVER_BASE = process.env.KNOWLEVER_DATA
  || join(process.env.HOME ?? '~', 'Polarisor/KnowLever/data');
const DEFAULT_USER = 'admin';

export interface PushOptions {
  topic: string;
  user?: string;
}

export function pushVideoToKnowLever(
  videoPath: string,
  summaryPath: string | null,
  transcriptPath: string | null,
  title: string,
  options: PushOptions,
): { pushed: string[] } {
  const user = options.user || DEFAULT_USER;
  const rawDir = join(KNOWLEVER_BASE, 'users', user, 'topics', options.topic, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const pushed: string[] = [];
  const safeName = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 60);

  if (existsSync(videoPath)) {
    const ext = videoPath.match(/\.\w+$/)?.[0] || '.mp4';
    const destVideo = join(rawDir, `${safeName}${ext}`);
    if (!existsSync(destVideo)) {
      copyFileSync(videoPath, destVideo);
      pushed.push(destVideo);
      console.log(`[KnowLever] Pushed video: ${destVideo}`);
    }
  }

  if (summaryPath && existsSync(summaryPath)) {
    const destSummary = join(rawDir, `${safeName}.summary.md`);
    if (!existsSync(destSummary)) {
      copyFileSync(summaryPath, destSummary);
      pushed.push(destSummary);
      console.log(`[KnowLever] Pushed summary: ${destSummary}`);
    }
  }

  if (transcriptPath && existsSync(transcriptPath)) {
    const destTranscript = join(rawDir, `${safeName}.transcript.md`);
    if (!existsSync(destTranscript)) {
      copyFileSync(transcriptPath, destTranscript);
      pushed.push(destTranscript);
      console.log(`[KnowLever] Pushed transcript: ${destTranscript}`);
    }
  }

  return { pushed };
}

export function pushMarkdownToKnowLever(
  content: string,
  filename: string,
  options: PushOptions,
): string {
  const user = options.user || DEFAULT_USER;
  const rawDir = join(KNOWLEVER_BASE, 'users', user, 'topics', options.topic, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const dest = join(rawDir, filename.endsWith('.md') ? filename : `${filename}.md`);
  writeFileSync(dest, content);
  console.log(`[KnowLever] Pushed: ${dest}`);
  return dest;
}

export function getAvailableTopics(user?: string): string[] {
  const topicsDir = join(KNOWLEVER_BASE, 'users', user || DEFAULT_USER, 'topics');
  if (!existsSync(topicsDir)) return [];
  return readdirSync(topicsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}
