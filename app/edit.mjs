const excluded = new Set([
  'layout','html','htmlFile','css','cssFile','svg','img','figure','background','ctaGoto','goto','id',
  'fidelityLayout','elasticLayout','fidelityBackup','elasticBackup','blockTweaks','freeBlocks','buildBlocks'
]);
export function fieldsOf(page, pack) {
  const fields = new Map();
  const spec = pack.layouts.find(l => l.id === page.layout);
  const slots = spec?.slots || [];
  const slotSpecs = spec?.slotSpecs || pack.slots?.[page.layout] || {};
  function walk(obj, prefix='', parent='') {
    for (const [key,value] of Object.entries(obj)) {
      if (excluded.has(key)) continue;
      const path = Array.isArray(obj) ? prefix+'['+key+']' : (prefix ? prefix+'.' : '')+key;
      const field = Array.isArray(obj) ? parent : key;
      const slot = path.replace(/\[\d+\]/g,'[]').replace(/\.cells\[\]$/,'.cells');
      if (typeof value === 'string' && (slots.includes(slot) || Object.hasOwn(pack.limits||{},field) || field==='tip')) {
        const limit = slotSpecs[slot]?.max ?? slotSpecs[field]?.max ?? pack.limits?.[field];
        fields.set(path,{obj,key,field,value,limit});
      } else if (value && typeof value === 'object') walk(value,path,field);
    }
  }
  walk(page);
  return fields;
}
export const length = s => Array.from(s).length;
const math = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
export function shorten(value,max,field) {
  if (!max || length(value)<=max) return value;
  if (field==='formula') throw Error('公式超过字数上限，请手动精简');
  let result='';
  for (const [i,part] of value.split(math).entries()) {
    if (length(result)+length(part)<=max) result+=part;
    else { if (i%2===0) result+=Array.from(part).slice(0,max-length(result)).join(''); break; }
  }
  return result;
}
export function splitLines(value) {
  if (length(value)<=40 || value.includes('\n')) return value;
  return value.split(math).map((s,i)=>i%2?s:s.replace(/[。；]/g,'$&\n')).join('').replace(/\n$/,'');
}
export const scaleRule = /:scope\s*\{\s*--page-scale:\s*([\d.]+)\s*;?\s*\}/;

export function buildRows(page, layout) {
  const paths = new Set((layout?.slots || []).filter(s => s.includes('[].')).map(s => s.split('[].')[0]));
  return [...paths].flatMap(path => {
    const rows = path.split('.').reduce((obj, key) => obj?.[key], page);
    return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  });
}
export function buildGroups(rows, all = false) {
  const groups = new Map();
  let max = 0;
  for (const row of rows) {
    if (Number.isSafeInteger(row.build) && row.build > 0) {
      groups.set(row, row.build);
      max = Math.max(max, row.build);
    }
  }
  for (const row of rows) if (row.build === true) groups.set(row, ++max);
  if (all) for (const row of rows) if (!groups.has(row)) groups.set(row, ++max);
  return groups;
}
