// 把导入页里的文字块变成可编辑字段：原文进 deck.json，版式里放 {{tN}} 占位符
import { parseFragment, serialize } from 'parse5';

const NOISE = /^[\d\s·•.,，、。:：;；\-—–/\\|()（）\[\]【】]+$/;

export function extractTextSlots(html, { max = 120 } = {}) {
  const tree = parseFragment(html);
  const values = {};
  const labels = {};
  let count = 0;
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (!child.tagName) continue;
      const kids = child.childNodes || [];
      const hasElement = kids.some((k) => k.tagName);
      const text = kids.filter((k) => k.nodeName === '#text').map((k) => k.value).join('').trim();
      if (!hasElement && text && count < max && !NOISE.test(text)) {
        count += 1;
        const key = 't' + count;
        values[key] = text;
        labels[key] = text.length > 14 ? text.slice(0, 14) + '…' : text;
        child.childNodes = [{ nodeName: '#text', value: '{{' + key + '}}' }];
      }
      walk(child);
    }
  };
  walk(tree);
  return { html: serialize(tree), values, labels, slots: Object.keys(values) };
}
