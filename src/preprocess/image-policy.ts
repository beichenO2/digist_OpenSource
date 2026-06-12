export type ImageDomain = 'finance' | 'medical' | 'general' | 'tech' | 'academic';

export interface ImageDecision {
  keep: boolean;
  reason: string;
  vlmRequired: boolean;
}

const DISCARD_DOMAINS: ImageDomain[] = ['finance', 'tech'];
const KEEP_DOMAINS: ImageDomain[] = ['medical', 'academic'];

export function shouldKeepImage(
  domain: ImageDomain,
  imageContext?: { caption?: string; surroundingText?: string; fileSize?: number }
): ImageDecision {
  if (DISCARD_DOMAINS.includes(domain)) {
    return {
      keep: false,
      reason: `Domain "${domain}" — image info is typically redundant with text`,
      vlmRequired: false,
    };
  }

  if (KEEP_DOMAINS.includes(domain)) {
    return {
      keep: true,
      reason: `Domain "${domain}" — images carry essential information (diagrams, specimens, etc.)`,
      vlmRequired: true,
    };
  }

  if (imageContext?.caption && imageContext.caption.length > 20) {
    return {
      keep: true,
      reason: 'Has meaningful caption — likely informative',
      vlmRequired: true,
    };
  }

  if (imageContext?.fileSize && imageContext.fileSize < 5000) {
    return {
      keep: false,
      reason: 'Tiny image (<5KB) — likely icon/decoration',
      vlmRequired: false,
    };
  }

  return {
    keep: false,
    reason: 'General domain, no strong signal — discard to reduce cost',
    vlmRequired: false,
  };
}

export function detectDomainFromContent(text: string): ImageDomain {
  const lower = text.toLowerCase();

  if (/stock|trading|crypto|bitcoin|etf|portfolio|interest rate|yield/i.test(lower)) return 'finance';
  if (/patient|diagnosis|clinical|symptom|treatment|mri|ct scan|pathology/i.test(lower)) return 'medical';
  if (/algorithm|api|sdk|framework|compiler|database|backend|frontend/i.test(lower)) return 'tech';
  if (/研究|论文|实验|methodology|hypothesis|abstract|conclusion|citation/i.test(lower)) return 'academic';

  return 'general';
}

export function buildImageProcessingPipeline(
  domain: ImageDomain
): { step: string; description: string }[] {
  const base = [
    { step: 'detect', description: 'Identify images in document' },
    { step: 'classify', description: 'Determine image type (chart/photo/diagram/icon)' },
  ];

  if (DISCARD_DOMAINS.includes(domain)) {
    return [
      ...base,
      { step: 'discard', description: 'Remove images — text contains equivalent info' },
      { step: 'reference', description: 'Add "[Image: description]" placeholder in markdown' },
    ];
  }

  return [
    ...base,
    { step: 'extract', description: 'Extract image bytes' },
    { step: 'vlm', description: 'Send to VLM for description/OCR' },
    { step: 'embed', description: 'Include VLM output inline in markdown' },
    { step: 'index', description: 'Store image reference for RAG retrieval' },
  ];
}
