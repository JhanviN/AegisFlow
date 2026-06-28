/** Regex-based PII fallback when ML inference is unavailable. */

export interface RegexMaskResult {
  maskedText: string;
  mapping: Record<string, string>;
  entitiesFound: number;
}

const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  { name: "PHONE", regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { name: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "CREDIT_CARD", regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
  {
    name: "IP_ADDRESS",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },
  {
    name: "PERSON_NAME",
    regex: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
  },
];

let counter = 0;

function nextPlaceholder(entityType: string): string {
  counter += 1;
  return `AEGIS_${entityType}_${counter}`;
}

export function regexMaskPii(text: string): RegexMaskResult {
  counter = 0;
  const mapping: Record<string, string> = {};
  let masked = text;

  const replacements: Array<{ start: number; end: number; placeholder: string; original: string }> =
    [];

  for (const { name, regex } of PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const original = match[0];
      const placeholder = nextPlaceholder(name);
      mapping[placeholder] = original;
      replacements.push({
        start: match.index,
        end: match.index + original.length,
        placeholder,
        original,
      });
    }
  }

  replacements.sort((a, b) => b.start - a.start);
  const used: Array<[number, number]> = [];

  for (const { start, end, placeholder } of replacements) {
    if (used.some(([s, e]) => start < e && end > s)) continue;
    used.push([start, end]);
    masked = masked.slice(0, start) + placeholder + masked.slice(end);
  }

  return {
    maskedText: masked,
    mapping,
    entitiesFound: Object.keys(mapping).length,
  };
}

export function verifyStructuralSafety(text: string): boolean {
  for (const { regex } of PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    if (re.test(text)) {
      return false;
    }
  }
  return true;
}

export function rehydrateText(text: string, mapping: Record<string, string>): string {
  let result = text;
  const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const placeholder of sortedKeys) {
    result = result.split(placeholder).join(mapping[placeholder]);
  }
  return result;
}

export function maskMessages(
  messages: Array<{ role: string; content: string }>,
): { maskedMessages: Array<{ role: string; content: string }>; mapping: Record<string, string> } {
  const combinedMapping: Record<string, string> = {};
  const maskedMessages = messages.map((msg) => {
    const result = regexMaskPii(msg.content);
    Object.assign(combinedMapping, result.mapping);
    return { role: msg.role, content: result.maskedText };
  });
  return { maskedMessages, mapping: combinedMapping };
}
