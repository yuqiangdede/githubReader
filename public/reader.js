export function parseRepo(value) {
  const cleaned = value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) throw new Error('请输入 owner/repo 或 GitHub 仓库首页地址');
  return cleaned;
}
export function plainText(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '').replace(/([*_~`])\1?/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
export function splitText(text, limit = 160) {
  const result = [];
  for (const paragraph of text.split(/\n+/).filter(x => x.trim())) {
    const sentences = paragraph.match(/[^。！？.!?；;]+[。！？.!?；;]?/g) || [paragraph];
    for (const sentence of sentences) { const chars = Array.from(sentence.trim()); for (let i = 0; i < chars.length; i += limit) { const part = chars.slice(i, i + limit).join(''); if (part) result.push(part); } }
  }
  return result;
}
