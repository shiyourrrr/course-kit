const containerKinds = ['card', 'note-item', 'figure', 'cmp-col', 'aim', 'task'];
const moveOnlyKinds = ['heading', 'paragraph', 'list-item', 'table', 'formula'];

function tagOf(node) {
  return node?.tagName?.toLowerCase();
}

function attributeOf(node, name) {
  return node.getAttribute?.(name) ?? node.attrs?.find(attr => attr.name === name)?.value ?? '';
}

function classesOf(node) {
  return attributeOf(node, 'class').split(/\s+/);
}

const inlineTags = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'em', 'i', 'label',
  'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u']);

function standaloneImage(node) {
  for (let child = node; child.parentNode; child = child.parentNode) {
    const parent = child.parentNode;
    for (const sibling of parent.childNodes) {
      if (sibling === child) continue;
      if (sibling.nodeName === '#text' && (sibling.nodeValue ?? sibling.value ?? '').trim()) return false;
      if (inlineTags.has(tagOf(sibling))) {
        const content = {media:false, text:false};
        mediaContent(sibling, content);
        if (content.text) return false;
      }
    }
    if (!inlineTags.has(tagOf(parent)) && tagOf(parent) !== 'picture') break;
  }
  return true;
}

export function blockKind(node) {
  const tag = tagOf(node);
  if (!tag || (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml')) return null;
  for (let parent = node.parentNode; tagOf(parent); parent = parent.parentNode) {
    const classes = classesOf(parent);
    if (['table', 'svg', 'math', 'footer', 'nav'].includes(tagOf(parent)) ||
        ['formula-box', 'katex', 'katex-display', 'slide-bg'].some(cls => classes.includes(cls))) return null;
    if (classes.includes('slide')) break;
  }
  const classes = classesOf(node);
  if (['footer', 'nav'].includes(tag) || ['slide', 'slide-bg', 'katex'].some(cls => classes.includes(cls))) return null;
  if (classes.includes('formula-box') || classes.includes('katex-display')) return 'formula';
  const container = containerKinds.find(kind => classes.includes(kind));
  if (container) return container;
  if (/^h[1-6]$/.test(tag) || attributeOf(node, 'role') === 'heading' ||
      (['div', 'p'].includes(tag) && classes.includes('title'))) return 'heading';
  if (tag === 'img') return standaloneImage(node) ? 'image' : null;
  if (tag === 'p') return 'paragraph';
  if (tag === 'li') return 'list-item';
  if (tag === 'table') return 'table';
  return null;
}

// SVG text labels are part of the artwork. HTML captions need room to wrap.
function mediaContent(node, state) {
  if (['img', 'svg', 'video', 'canvas'].includes(tagOf(node))) {
    state.media = true;
  } else if (node.nodeName === '#text') {
    if ((node.nodeValue ?? node.value ?? '').trim()) state.text = true;
  } else {
    for (const child of node.childNodes || []) mediaContent(child, state);
  }
}

export function resizeMode(node) {
  const kind = blockKind(node);
  if (kind === 'image') return 'ratio';
  if (!containerKinds.includes(kind)) return 'none';
  const content = {media:false, text:false};
  mediaContent(node, content);
  return content.media && !content.text ? 'both' : 'width';
}

// A content signature survives layout, animation and editor-only attribute changes.
export function blockFingerprint(node) {
  let hash = 2166136261;
  const add = value => {
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ 0xffff, 16777619);
  };
  const visit = child => {
    if (child.nodeName === '#text') {
      const value = (child.nodeValue ?? child.value).replace(/\s+/g, ' ').trim();
      if (value) add(value);
      return;
    }
    if (!child.tagName) return;
    add(tagOf(child));
    for (const attr of child.attributes ?? child.attrs ?? []) {
      if (['src', 'alt', 'd', 'points', 'x', 'y', 'cx', 'cy', 'r', 'fill', 'stroke'].includes(attr.name)) {
        add(attr.name);
        add(attr.value);
      }
    }
    for (const descendant of child.childNodes || []) visit(descendant);
    add('/');
  };
  visit(node);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function validTweak(tweak) {
  if (!tweak || typeof tweak !== 'object') return false;
  if (tweak.targetKey !== undefined && (typeof tweak.targetKey !== 'string' || !/^[0-9a-f]{8}$/.test(tweak.targetKey))) return false;
  if (tweak.hidden !== undefined && typeof tweak.hidden !== 'boolean') return false;
  if (tweak.fontSize !== undefined && (!Number.isSafeInteger(tweak.fontSize) || tweak.fontSize < 12 || tweak.fontSize > 120)) return false;
  if (tweak.color !== undefined && (typeof tweak.color !== 'string' || (tweak.color !== '' && !/^#[0-9a-fA-F]{6}$/.test(tweak.color)))) return false;
  if (tweak.align !== undefined && (typeof tweak.align !== 'string' || (tweak.align !== '' && !['left', 'center', 'right'].includes(tweak.align)))) return false;
  if (tweak.zIndex !== undefined && (!Number.isSafeInteger(tweak.zIndex) || tweak.zIndex < -10 || tweak.zIndex > 50)) return false;
  const {path, kind, dx = 0, dy = 0, widthStep = 0, widthPx, heightPx} = tweak;
  if (!Array.isArray(path) || !path.length || !Array.from(path).every(i => Number.isSafeInteger(i) && i >= 0)) return false;
  if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy) || ![-1, 0, 1].includes(widthStep)) return false;
  if (![widthPx, heightPx].every(size => size === undefined || (Number.isSafeInteger(size) && size > 0))) return false;
  return moveOnlyKinds.includes(kind) || containerKinds.includes(kind) || kind === 'image';
}
