// Mask math with equal-length spans so delimiter offsets still index the original line.
function outsideMath(text) {
  return text.replace(/\$\$(?:\\.|[^$\\]|\$(?!\$))*\$\$|\$(?:\\.|[^$\\])*\$/g, s => '~'.repeat(s.length));
}

const numberPattern = String.raw`(?:第\s*(\d+)\s*题\s*[：:]?|[（(](\d+)[）)]|(\d+)(?:[、．]|\.(?!\d)))`;
const start = new RegExp('^(?:###\\s*)?' + numberPattern + '\\s*');
const typeTag = /^[【\[](单选|多选|判断|填空|解答)(?:题)?[】\]]\s*/;
const fieldMarker = /(?:【(答案|解析)】\s*[：:]?|(答案|答|解析)\s*[：:])/g;
const optionMarker = /(?<![A-Za-z])(?:[（(]([A-Z])[）)]|([A-Z])[.、．])/g;
const referenceHeading = new RegExp('^(?:【参考答案】|参考答案)\\s*(?:[：:]\\s*|(?=$|' + numberPattern + '))');
const letters = 'ABCDEFGH';

function materialize(block) {
  const {stem, options, explain} = block;
  let {type, answer} = block;
  if (!stem) throw Error('缺少题干');
  if (options.length === 1) throw Error('只有一个选项，请补全选项');
  const marked = options.flatMap((o,i) => o.correct ? [letters[i]] : []).join('');
  let correct = marked;
  if (options.length && /^[A-Ha-h](?:[\s,，、]*[A-Ha-h])*$/.test(answer)) {
    const keys = answer.toUpperCase().replace(/[\s,，、]/g,'').split('');
    if (keys.some(k => letters.indexOf(k) >= options.length)) throw Error('答案引用了不存在的选项');
    correct = [...new Set(keys)].sort().join('');
    if (marked && marked !== correct) throw Error('答案与选项上的正确标记冲突');
  }
  if (!type) {
    if (options.length) type = correct.length > 1 ? '多选' : '单选';
    else if (outsideMath(stem).includes('___')) type = '填空';
    else if ([...stem].length >= 12) type = '解答';
    else throw Error('题干过短，缺少题型、选项或填空线');
  }
  if (['单选','多选'].includes(type) && !options.length) throw Error('选择题缺少选项');
  if (type === '单选' && correct.length > 1) throw Error('单选题有多个正确项');
  if (!answer) answer = correct;
  return {type,stem,options:options.map((o,i)=>({...o,correct:correct.includes(letters[i])})),answer,explain};
}

function addOption(block, key, value, checked = false) {
  if (key !== letters[block.options.length] || !key) throw Error('选项应从 A 开始连续排列，最多到 H');
  const marked = /[√*]$/.test(outsideMath(value));
  const text = (marked ? value.slice(0,-1) : value).trim();
  if (!text) throw Error('选项内容为空');
  block.options.push({correct:checked || marked,text});
}

function fields(block, text, matches) {
  for (const [i,m] of matches.entries()) {
    const field = (m[1] || m[2]) === '解析' ? 'explain' : 'answer';
    const value = text.slice(m.index+m[0].length,matches[i+1]?.index).trim();
    if (!value) throw Error('答案或解析标记后缺少内容');
    if (block[field] && block[field] !== value) throw Error('同一道题有相互冲突的答案或解析');
    block[field] = value;
  }
}

function readLine(block, text, isHead) {
  text = text.replace(/^>\s*/, '');
  const markers = [...outsideMath(text).matchAll(fieldMarker)];
  const content = text.slice(0,markers[0]?.index).trim();
  const check = /^-\s*\[([ xX])\]\s*(.*)$/.exec(content);
  if (check) {
    addOption(block,letters[block.options.length],check[2],check[1].toLowerCase()==='x');
    fields(block,text,markers);
    return true;
  }
  const options = [...outsideMath(content).matchAll(optionMarker)];
  const prefix = content.slice(0,options[0]?.index).trim();
  if (isHead) block.stem = prefix;
  else if (prefix) return false;
  for (const [i,m] of options.entries()) {
    addOption(block,m[1] || m[2],content.slice(m.index+m[0].length,options[i+1]?.index).trim());
  }
  fields(block,text,markers);
  return true;
}

/** Parse numbered questions and report source lines using one-based numbering. */
export function parseQuestions(text) {
  const questions = [], unparsed = [], blocks = [], indexed = new Map();
  const reject = (row,reason) => unparsed.push({...row,reason});
  let current, inReferences = false, reference;
  function attach(block,row,fn) {
    block.rows.push(row);
    try { fn(); } catch (e) { block.error ||= e.message; }
  }
  function referenceLine(value,row) {
    const markers = [...outsideMath(value).matchAll(new RegExp('(?:^|\\s+)' + numberPattern,'g'))];
    if (!markers.length) {
      const matches = [...outsideMath(value).matchAll(fieldMarker)];
      if (reference && matches[0]?.index === 0) attach(reference,row,()=>fields(reference,value,matches));
      else reject(row,'参考答案缺少可匹配的题号');
      return;
    }
    if (value.slice(0,markers[0].index).trim()) {
      reject(row,'参考答案行开头缺少题号');
      return;
    }
    for (const [i,m] of markers.entries()) {
      const key = Number(m[1] || m[2] || m[3]);
      const targets = indexed.get(key) || [];
      reference = targets.length === 1 ? targets[0] : null;
      if (!reference) { reject(row,'参考答案题号不存在或重复：'+key); continue; }
      const entry = value.slice(m.index+m[0].length,markers[i+1]?.index).trim();
      const matches = [...outsideMath(entry).matchAll(fieldMarker)];
      const annotated = matches[0]?.index === 0 ? entry : '答案：'+entry;
      attach(reference,row,()=>fields(reference,annotated,[...outsideMath(annotated).matchAll(fieldMarker)]));
    }
  }
  for (const [i,raw] of text.split(/\r\n?|\n/).entries()) {
    const row = {line:i+1,text:raw};
    let value = raw.trim();
    if (!value || /^#\s+/.test(value)) continue;
    const ref = referenceHeading.exec(value);
    if (ref) {
      current = reference = null;
      inReferences = true;
      value = value.slice(ref[0].length);
      if (!value) continue;
    }
    if (inReferences) { referenceLine(value,row); continue; }
    const head = start.exec(value);
    if (head) {
      value = value.slice(head[0].length);
      const tag = typeTag.exec(value);
      current = {type:tag?.[1] || '', stem:'', options:[], answer:'', explain:'', rows:[]};
      const key = Number(head[1] || head[2] || head[3]);
      if (!indexed.has(key)) indexed.set(key,[]);
      indexed.get(key).push(current);
      blocks.push(current);
      if (tag) value = value.slice(tag[0].length);
      else if (/^[【\[][^】\]]+[】\]]/.test(value)) current.error = '未知的题型标记';
      attach(current,row,()=>readLine(current,value,true));
    } else if (!current) reject(row,'未找到可归属的题号');
    else {
      try {
        if (readLine(current,value,false)) current.rows.push(row);
        else reject(row,'无法确定此行属于题干、选项、答案还是解析');
      } catch (e) { current.error ||= e.message; current.rows.push(row); }
    }
  }
  for (const block of blocks) {
    try {
      if (block.error) throw Error(block.error);
      questions.push(materialize(block));
    } catch (e) {
      for (const row of block.rows) reject(row,e.message);
    }
  }
  const seen = new Set();
  return {questions,unparsed:unparsed.sort((a,b)=>a.line-b.line).filter(row=>{
    if (seen.has(row.line)) return false;
    seen.add(row.line);
    return true;
  })};
}
