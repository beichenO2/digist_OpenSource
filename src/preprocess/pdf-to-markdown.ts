import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

export interface PdfConvertOptions {
  outputDir?: string;
  preserveTables?: boolean;
  preserveFormulas?: boolean;
  maxPages?: number;
}

export interface PdfConvertResult {
  success: boolean;
  markdown: string;
  pages: number;
  method: string;
  error?: string;
}

export async function pdfToMarkdown(
  pdfPath: string,
  options: PdfConvertOptions = {}
): Promise<PdfConvertResult> {
  if (!existsSync(pdfPath)) {
    return { success: false, markdown: '', pages: 0, method: 'none', error: `File not found: ${pdfPath}` };
  }

  const methods = [
    tryPdfToText,
    tryPythonPdfminer,
    tryBasicExtract,
  ];

  for (const method of methods) {
    try {
      const result = await method(pdfPath, options);
      if (result.success && result.markdown.trim().length > 50) {
        return result;
      }
    } catch {
      continue;
    }
  }

  return { success: false, markdown: '', pages: 0, method: 'all-failed', error: 'All extraction methods failed' };
}

async function tryPdfToText(pdfPath: string, options: PdfConvertOptions): Promise<PdfConvertResult> {
  try {
    const pageFlag = options.maxPages ? `-l ${options.maxPages}` : '';
    const output = execSync(`pdftotext -layout ${pageFlag} "${pdfPath}" -`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    });

    const pages = (output.match(/\f/g) ?? []).length + 1;
    const markdown = formatAsMarkdown(output);

    return { success: true, markdown, pages, method: 'pdftotext' };
  } catch {
    return { success: false, markdown: '', pages: 0, method: 'pdftotext', error: 'pdftotext not available' };
  }
}

async function tryPythonPdfminer(pdfPath: string, options: PdfConvertOptions): Promise<PdfConvertResult> {
  try {
    const maxPagesArg = options.maxPages ? `--page-numbers ${Array.from({ length: options.maxPages }, (_, i) => i).join(' ')}` : '';
    const output = execSync(`python3 -m pdfminer.high_level ${maxPagesArg} "${pdfPath}"`, {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
    });

    const pages = (output.match(/\f/g) ?? []).length + 1;
    const markdown = formatAsMarkdown(output);

    return { success: true, markdown, pages, method: 'pdfminer' };
  } catch {
    return { success: false, markdown: '', pages: 0, method: 'pdfminer', error: 'pdfminer not available' };
  }
}

async function tryBasicExtract(pdfPath: string, _options: PdfConvertOptions): Promise<PdfConvertResult> {
  try {
    const raw = readFileSync(pdfPath);
    const textChunks: string[] = [];

    const text = raw.toString('latin1');
    const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
    let match;
    while ((match = streamRegex.exec(text)) !== null) {
      const content = match[1];
      const textContent = content.replace(/[^\x20-\x7E\n\r\t]/g, '');
      if (textContent.trim().length > 20) {
        textChunks.push(textContent.trim());
      }
    }

    if (textChunks.length === 0) {
      return { success: false, markdown: '', pages: 0, method: 'basic', error: 'No text extracted' };
    }

    return {
      success: true,
      markdown: textChunks.join('\n\n---\n\n'),
      pages: 1,
      method: 'basic',
    };
  } catch (err) {
    return { success: false, markdown: '', pages: 0, method: 'basic', error: String(err) };
  }
}

function formatAsMarkdown(rawText: string): string {
  let md = rawText;

  md = md.replace(/\f/g, '\n\n---\n\n');
  md = md.replace(/\n{4,}/g, '\n\n\n');
  md = md.replace(/[ \t]+$/gm, '');

  const lines = md.split('\n');
  const formatted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      formatted.push('');
      continue;
    }

    if (trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      formatted.push(`## ${trimmed}`);
    } else {
      formatted.push(line);
    }
  }

  return formatted.join('\n').trim();
}

export function savePdfAsMarkdown(pdfPath: string, outputDir: string): Promise<PdfConvertResult> {
  mkdirSync(outputDir, { recursive: true });
  return pdfToMarkdown(pdfPath, { outputDir }).then((result) => {
    if (result.success) {
      const outPath = join(outputDir, basename(pdfPath, '.pdf') + '.md');
      writeFileSync(outPath, result.markdown, 'utf-8');
    }
    return result;
  });
}
