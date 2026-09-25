export interface NorEasterBrief {
  headline: string;
  detail: string;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Pull the NWS Binghamton nor'easter wording. Returns nothing when that storm is not in the discussion. */
export function norEasterBrief(text: string): NorEasterBrief | null {
  if (!/nor[`']?easter/i.test(text)) return null;
  const messages = text.match(/\.KEY MESSAGES\.\.\.([\s\S]*?)(?:\n&&|\n\.[A-Z])/i);
  const detailMatch = text.match(/KEY MESSAGE 1\.\.\.([\s\S]*?)(?:\nKEY MESSAGE 2|\n&&|\n\.[A-Z])/i);
  const headline = collapse(messages?.[1] || "").split(/\s2\)\s/)[0];
  const detail = collapse(detailMatch?.[1] || "");
  if (!headline && !detail) return null;
  return {
    headline: headline.slice(0, 420),
    detail: detail.slice(0, 1600),
  };
}
