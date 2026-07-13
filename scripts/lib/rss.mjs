/** RSS/XML 파싱 유틸 — collect.mjs에서 분리 (테스트 가능하도록) */

export function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

export function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

/** RSS 문자열 → [{title, link, source, pubDate}] */
export function parseRss(xml, limit = 40) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    let title = tag(block, 'title');
    let source = tag(block, 'source');
    // Google News는 제목 끝에 " - 매체명"을 붙인다
    if (!source) {
      const dash = title.lastIndexOf(' - ');
      if (dash > 10) {
        source = title.slice(dash + 3);
        title = title.slice(0, dash);
      }
    } else {
      const suffix = ` - ${source}`;
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
    }
    let link = tag(block, 'link');
    if (!/^https?:\/\//i.test(link)) link = ''; // http(s) 외 스킴은 버림 — javascript: 등 주입 방어
    const pubDate = tag(block, 'pubDate');
    if (title) items.push({ title, link, source, pubDate });
    if (items.length >= limit) break;
  }
  return items;
}
