/**
 * Rewrite cached v12 (and similar) roast markdown so RoastReport can show the
 * stacked dimension-card layout without regenerating copy.
 *
 * Legacy shape:
 *   **一句话结论**: …
 *   | 维度 | 得分 | 说明 |  + rows
 *   **风险标记** / **建议** as bold labels with loose paragraphs
 *
 * Target shape (same as renderV13Report):
 *   > **一句话结论** / callout
 *   #### Name · score/max  + note paragraph
 *   ### 风险标记 / ### 建议 with - bullets
 */
const DIM_TABLE_HEADER =
  /^\|\s*(维度|Dimension)\s*\|\s*(得分|Score)\s*\|\s*(说明|Notes?|说明\/分析)\s*\|\s*$/i;
const DIM_ROW =
  /^\|\s*(.+?)\s*\|\s*([\d.]+)\s*\/\s*([\d.]+)\s*\|\s*(.*?)\s*\|\s*$/;
const SEP_ROW = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|\s*$/;

export function rewriteLegacyRoastMarkdown(md: string): string {
  if (!md || !md.includes("|")) {
    return rewriteLegacyLabels(md);
  }
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let sawDimTable = false;
  while (i < lines.length) {
    const line = lines[i];
    if (DIM_TABLE_HEADER.test(line.trim())) {
      // Skip header + optional separator, convert body rows.
      i++;
      if (i < lines.length && SEP_ROW.test(lines[i].trim())) i++;
      const cards: string[] = [];
      while (i < lines.length) {
        const row = lines[i].trim();
        if (!row.startsWith("|")) break;
        if (SEP_ROW.test(row)) {
          i++;
          continue;
        }
        const m = row.match(DIM_ROW);
        if (m) {
          cards.push(`#### ${m[1].trim()} · ${m[2]}/${m[3]}`, "", m[4].trim(), "");
          sawDimTable = true;
        } else {
          // Unknown table row — keep raw so we do not destroy content.
          cards.push(lines[i]);
        }
        i++;
      }
      if (cards.length) {
        // Ensure a section heading if the legacy report lacked ### 维度评分.
        const prev = [...out].reverse().find((l) => l.trim()) ?? "";
        if (!/^#{2,3}\s/.test(prev) && !/维度|Dimension/i.test(prev)) {
          if (out.length && out[out.length - 1] !== "") out.push("");
          const zh = /[\u4e00-\u9fff]/.test(md.slice(0, 400));
          out.push(zh ? "### 维度评分" : "### Dimensions", "");
        }
        out.push(...cards);
      }
      continue;
    }
    out.push(line);
    i++;
  }
  let text = out.join("\n");
  text = rewriteLegacyLabels(text);
  // Only collapse excess blank lines when we actually rewrote a table.
  if (sawDimTable) text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

/** Promote bold legacy section labels into the v13 markdown conventions. */
function rewriteLegacyLabels(md: string): string {
  if (!md) return md;
  let text = md;
  // **一句话结论**: body  → blockquote callout (skip if already a blockquote).
  text = text.replace(
    /^(?:>\s*)?\*\*(一句话结论|TL;DR)\*\*\s*[:：]\s*(.+)$/gm,
    (_, label: string, body: string) => `> **${label}**\n>\n> ${body.trim()}`,
  );
  // **风险标记** / **建议** as their own line → ### heading
  text = text.replace(/^\*\*(风险标记|Red flags|建议|Next)\*\*\s*$/gm, "### $1");
  // Under ### 建议 / ### Next, turn bare paragraphs into bullets when the
  // section has no list markers yet (legacy shipped plain paragraphs).
  text = bulletizeAdviceSection(text);
  return text;
}

function bulletizeAdviceSection(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inAdvice = false;
  let adviceHasList = false;
  const buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    if (inAdvice && !adviceHasList) {
      for (const p of buf) {
        const t = p.trim();
        if (!t) {
          out.push("");
          continue;
        }
        out.push(t.startsWith("- ") || /^\d+\.\s/.test(t) ? t : `- ${t}`);
      }
    } else {
      out.push(...buf);
    }
    buf.length = 0;
  };
  for (const line of lines) {
    if (/^###\s+(建议|Next)\s*$/.test(line.trim())) {
      flush();
      inAdvice = true;
      adviceHasList = false;
      out.push(line);
      continue;
    }
    if (/^###\s+/.test(line.trim()) || /^##\s+/.test(line.trim())) {
      flush();
      inAdvice = false;
      out.push(line);
      continue;
    }
    if (inAdvice) {
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) adviceHasList = true;
      buf.push(line);
    } else {
      out.push(line);
    }
  }
  flush();
  return out.join("\n");
}
