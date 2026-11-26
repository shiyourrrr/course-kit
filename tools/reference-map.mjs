const candidates = {
  cover: ['cover', 'statement'], summary: ['summary', 'closing', 'explain'],
  example: ['example', 'figure', 'paper', 'explain'],
  concept: ['concept', 'explain', 'statement'], explain: ['explain', 'concept', 'paper']
};

export function mapStructure(structure, pack) {
  if (!Array.isArray(structure) || !structure.length) return null;
  const supported = new Set(pack.layouts.map(layout => layout.id));
  const count = Math.min(12, structure.length);
  const pages = [];
  for (let i = 0; i < count; i++) {
    const index = count === 1 ? 0 : Math.round(i * (structure.length - 1) / (count - 1));
    const roles = structure[index]?.roles;
    if (!Array.isArray(roles) || !roles.some(r => ['title','lead','text','image','bullets','kicker'].includes(r?.type))) return null;
    const of = type => roles.filter(r => r?.type === type);
    const images = of('image');
    const points = of('bullets').reduce((sum, r) => sum + (Number(r.count) || 1), 0);
    const texts = of('text').length;
    const title = of('title').length;
    const lead = of('lead').length;
    const large = images.some(r => r.box?.w * r.box?.h >= 1280 * 720 * 0.25);
    const divider = !!of('kicker').length || (!!title && !texts && !points && !large);
    let type = 'explain';
    if (!i && images.length && ((title && lead) || (texts <= 1 && !points))) type = 'cover';
    else if (i === count - 1 && points <= 2 && texts <= 2) type = 'summary';
    else if (large) type = 'example';
    else if (points >= 3 || texts >= 3) type = 'concept';
    const layout = candidates[type].find(id => supported.has(id)) ||
      (supported.has('page-' + (index + 1)) && 'page-' + (index + 1));
    if (!layout) return null;
    pages.push({ layout, divider });
  }
  return pages;
}

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x,y) + 0.05) / (Math.min(x,y) + 0.05);
}

export function paletteCss(palette) {
  const colors = Array.isArray(palette) ? palette.filter(c => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c)) : [];
  if (!colors.length) return '';
  const ordered = [...colors].sort((a,b) => luminance(a) - luminance(b));
  const bg = ordered.at(-1);
  const readable = c => contrast(c,bg) >= 4.5;
  const ink = ordered.find(readable) || ['#000000','#ffffff'].find(readable);
  const accent = colors.find(c => readable(c) && !/^#(..)\1\1$/i.test(c)) || ink;
  const onAccent = contrast(accent,'#ffffff') >= 4.5 ? '#ffffff' : '#000000';
  return `:root { --bg: ${bg}; --ink: ${ink}; --ink-2: ${ink}; --ink-3: ${ink}; --accent: ${accent}; --accent-ink: ${onAccent}; } .slide:not(:has(> .slide-bg)) .title { color: var(--accent); }`;
}
