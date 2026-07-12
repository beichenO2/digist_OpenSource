/**
 * LLM-driven selector healer.
 *
 * When cached/seeded selectors stop matching (site redesign), we feed a trimmed
 * DOM sample + a description of the target item to the local LLM and ask it to
 * propose a fresh SelectorSet. The result is validated against the live DOM via
 * cheerio before being trusted, so a hallucinated selector can never silently
 * poison the store.
 */
import * as cheerio from 'cheerio';
import { generateText, isLocalLlmAvailable } from '../../utils/local-llm.js';
import type { SelectorSet } from './types.js';

/** Cheerio-validate a selector set against HTML: must yield ≥1 item with a title. */
export function validateSelectors(html: string, sel: SelectorSet): { ok: boolean; count: number } {
  try {
    const $ = cheerio.load(html);
    const items = $(sel.item);
    if (items.length === 0) return { ok: false, count: 0 };
    let withTitle = 0;
    items.each((_, el) => {
      const titleText = $(el).find(sel.title).first().text().trim();
      if (titleText) withTitle++;
    });
    return { ok: withTitle > 0, count: withTitle };
  } catch {
    return { ok: false, count: 0 };
  }
}

/** Compress HTML to a token-friendly structural sample for the LLM. */
function trimHtml(html: string, maxChars = 12_000): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, link, meta, iframe').remove();
  // Collapse whitespace-heavy body markup.
  const body = $('body').html() || html;
  const collapsed = body.replace(/\s+/g, ' ').replace(/>\s+</g, '><');
  return collapsed.slice(0, maxChars);
}

function parseSelectorJson(text: string): SelectorSet | null {
  // Tolerate code fences / prose around the JSON.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Partial<SelectorSet>;
    if (typeof obj.item === 'string' && typeof obj.title === 'string' && obj.item && obj.title) {
      return {
        item: obj.item,
        title: obj.title,
        link: typeof obj.link === 'string' ? obj.link : undefined,
        author: typeof obj.author === 'string' ? obj.author : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask the LLM for a selector set, validate against the DOM, return null if the
 * LLM is unavailable or every candidate fails validation.
 */
export async function healSelectors(
  html: string,
  itemDescription: string,
): Promise<{ set: SelectorSet; matched: number } | null> {
  if (!(await isLocalLlmAvailable())) return null;

  const sample = trimHtml(html);
  const prompt = `你是网页结构分析器。下面是一个网页的 body HTML（已精简）。目标：提取列表型内容条目——${itemDescription}。

请给出用于抽取的 CSS 选择器，输出严格 JSON（不要任何多余文字）：
{"item":"每个条目的容器选择器","title":"条目内标题选择器(相对item)","link":"条目内链接<a>选择器(相对item,可选)","author":"条目内作者选择器(相对item,可选)"}

要求：item 选择器要能匹配多个同类条目；title/link/author 是相对 item 的后代选择器；优先用稳定的语义标签/属性，避免一次性的哈希类名。

HTML:
${sample}`;

  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    let text: string;
    try {
      const resp = await generateText(prompt, {
        capability: '0011',
        maxTokens: 300,
        temperature: 0.1,
        system: '你只输出一个 JSON 对象，不输出解释、不加代码围栏。',
      });
      text = resp.text;
    } catch {
      return null;
    }
    const candidate = parseSelectorJson(text);
    if (candidate) {
      const check = validateSelectors(html, candidate);
      if (check.ok) {
        return { set: { ...candidate, source: 'llm-healed', learnedAt: new Date().toISOString() }, matched: check.count };
      }
    }
  }
  return null;
}
