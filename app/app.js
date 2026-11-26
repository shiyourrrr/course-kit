import {buildGroups,buildRows,fieldsOf,shorten,splitLines,scaleRule} from './edit.mjs';
import {validTweak} from './block-rules.mjs';
import {canToggleTemplateMode,isElasticLayout,toggleTemplateMode} from './template-switch.mjs';
import {mergeBlockTweak,hiddenBlocksOf,renderTemplateBlockInspector,SWATCH_COLORS} from './tweak-inspector.mjs';
import {initTemplateLibrary} from './template-library.mjs';
import {createTour} from './tour.mjs';
const histories=new Map();
const $ = id => document.getElementById(id);
const el = (tag, text) => Object.assign(document.createElement(tag), {textContent:text ?? ''});
const url = (route,key=name) => '/api/' + route + '?name=' + encodeURIComponent(key);
async function request(address, data) {
  const response = await fetch(address,data === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '操作失败');
  return value;
}
let name, deck, pack, index=0, revision=0, selection=0, timer, noticeTimer, packs=[];
let editSeq=0, previewedSeq=-1, loadedRevision=0, gotoTarget=-1;
const working = new Map();
function notice(message) {
  $('toast').textContent = $('last').textContent = message.split('\n').filter(Boolean).at(-1);
  $('log').textContent = message + '\n' + $('log').textContent;
  clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>$('toast').textContent='',2800);
}
function action(fn) {
  return async (...args)=>{try { await fn(...args); } catch(e) { notice(e.message); }};
}
function button(label,run) {
  const b=el('button',label);
  b.type='button';
  b.onclick=action(run);
  return b;
}
/* 侧栏「导入材料」右侧的数量徽标（只是显示，不影响材料数据） */
function showMaterialCount(n) {
  const badge=$('materialCount');
  badge.textContent=String(n);
  badge.title='已挂 '+n+' 份材料';
  badge.classList.toggle('is-empty',!n);
}
/* 一键收起 / 展开左侧课件栏：纯界面状态，记在本机 localStorage；窄窗首次打开默认收起 */
{
  const SIDE_KEY='ck.sideCollapsed', toggle=$('sideToggle');
  const applySide=collapsed=>{
    document.body.classList.toggle('side-collapsed',collapsed);
    toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.title=collapsed?'展开课件栏':'收起课件栏';
  };
  let stored=null;
  try{stored=localStorage.getItem(SIDE_KEY);}catch{}
  applySide(stored===null?innerWidth<900:stored==='1');
  toggle.onclick=()=>{
    const collapsed=!document.body.classList.contains('side-collapsed');
    applySide(collapsed);
    try{localStorage.setItem(SIDE_KEY,collapsed?'1':'0');}catch{}
  };
}
async function library() {
  const list=await request('/api/decks');
  catalog=list;
  renderLibrary();
  return list;
}
let catalog=[];
function relativeTime(mtime) {
  const now=new Date(), date=new Date(mtime);
  const minutes=Math.floor((now-date)/60000);
  if(now.toDateString()===date.toDateString()){
    if(minutes<1)return '刚刚';
    return minutes<60?minutes+' 分钟前':Math.floor(minutes/60)+' 小时前';
  }
  now.setDate(now.getDate()-1);
  if(now.toDateString()===date.toDateString())return '昨天';
  return [date.getMonth()+1,date.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
}
const sampleGroup=$('samples').parentElement;
let samplesOpen=false;
function renderLibrary(){
  const query=$('deckSearch').value.trim().toLowerCase();
  const matches=catalog.filter(item=>item.title.toLowerCase().includes(query));
  $('decks').replaceChildren(); $('samples').replaceChildren();
  for (const item of matches) {
    const b=button(item.title,()=>openDeck(item.name));
    b.className='deck' + (item.name===name?' selected':'');
    b.dataset.name=item.name;
    const marker=el('span',' ·未保存');
    marker.className='dirtyMark';
    marker.hidden=!working.get(item.name)?.dirty;
    b.append(marker,el('small',item.pages+' 页 · '+relativeTime(item.mtime)));
    $(['cinema','cinema-gougu'].includes(item.name)?'samples':'decks').append(b);
  }
  sampleGroup.hidden=!$('samples').childElementCount;
  if(query && !sampleGroup.dataset.searching){
    samplesOpen=sampleGroup.open;
    sampleGroup.dataset.searching='true';
  }
  if(query)sampleGroup.open=true;
  else if(sampleGroup.dataset.searching){
    sampleGroup.open=samplesOpen;
    delete sampleGroup.dataset.searching;
  }
  $('libraryMessage').hidden=!!matches.length;
  $('libraryMessage').textContent=catalog.length?'没有匹配的课件':'还没有课件。点「＋ 新建课件」开始，或「＋ 导入模板 / 参照」用现成模板。';
}
$('deckSearch').oninput=renderLibrary;
function syncDirtyMark(){
  const marker=document.querySelector('.deck.selected .dirtyMark');
  if(marker)marker.hidden=!working.get(name)?.dirty;
}
async function openDeck(key) {
  const token=++selection;
  const data=working.get(key) ?? await request(url('deck',key));
  if (token!==selection) return;
  clearTimeout(timer); timer=null;
  name=key; ({deck,pack}=data); index=0; revision++;
  editSeq++; previewedSeq=-1; loadedRevision=0; gotoTarget=-1;
  $('status').textContent=data.dirty?'有未保存的修改':'已保存';
  for (const b of document.querySelectorAll('.deck')) b.classList.toggle('selected',b.dataset.name===name);
  $('layout').replaceChildren(...pack.layouts.map(l=>new Option(l.name,l.id)));
  draw(); await preview();
}
function layout(p) { return pack.layouts.find(l=>l.id===p.layout); }
function outlineTitle(p) {
  // 占位标题（PPT 导入普遍是"请输入标题"）不算内容，退回用正文首句，改内容大纲才会跟着动
  const title = p.title?.trim();
  if (title && !/^(请?输入标题|未填写标题|无标题|标题|第\s*\d+\s*页)$/.test(title)) return title;
  const candidates = [...fieldsOf(p,pack).values()].map(field=>field.value);
  if (p.html) candidates.push(new DOMParser().parseFromString(p.html,'text/html').body.textContent);
  for (const block of p.freeBlocks || []) if (block.type==='text') candidates.push(block.text);
  for (const candidate of candidates) {
    const text = candidate?.replace(/<[^>]+>/g,'').trim();
    if (text && !/^(请?输入标题|未填写标题|无标题|标题|第\s*\d+\s*页)$/.test(text)) return Array.from(text).slice(0,12).join('');
  }
  return '未填写标题';
}
function selectOutlinePage(i) {
  index=i;
  selectedBlock=null;
  pendingReplacement=null;
  syncAssetReplaceButton();
  showFreeForm();
  draw();
  if (previewedSeq===editSeq && loadedRevision===revision && !timer) {
    gotoTarget=i;
    postPreview('goto',{index:i});
  } else {
    preview(0,i);
  }
}
function outline() {
  const list=$('pages'), scroll=list.scrollTop;
  $('count').textContent=deck.pages.length+' 页';
  if (list.children.length === deck.pages.length) {
    deck.pages.forEach((p,i)=>{
      const row=list.children[i];
      row.className='row'+(i===index?' selected':'');
      const select=row.querySelector(':scope > button');
      if (select) {
        select.replaceChildren(
          document.createTextNode((i+1)+' · '+outlineTitle(p)),
          el('small',(layout(p)?.name || '自定义页')+(p.notes?.trim()?' ·讲稿':''))
        );
      }
      const btns=row.querySelectorAll('.tools button');
      if (btns[0]) btns[0].disabled=i===0;
      if (btns[1]) btns[1].disabled=i===deck.pages.length-1;
      if (btns[3]) btns[3].disabled=deck.pages.length===1;
    });
    list.scrollTop=scroll;
    return;
  }
  list.replaceChildren(...deck.pages.map((p,i)=>{
    const row=el('div'); row.className='row'+(i===index?' selected':'');
    row.draggable=true; row.dataset.index=String(i); row.title='按住拖动可调整顺序';
    const grip=el('span','⋮⋮'); grip.className='grip'; grip.setAttribute('aria-hidden','true');
    const select=button((i+1)+' · '+outlineTitle(p),()=>selectOutlinePage(i));
    select.append(el('small',(layout(p)?.name || '自定义页')+(p.notes?.trim()?' ·讲稿':'')));
    row.append(select);
    const tools=el('div'); tools.className='tools';
    for (const [label,disabled,edit] of [
      ['上移',i===0,()=>{index=i-1;[deck.pages[i],deck.pages[index]]=[deck.pages[index],deck.pages[i]];}],
      ['下移',i===deck.pages.length-1,()=>{index=i+1;[deck.pages[i],deck.pages[index]]=[deck.pages[index],deck.pages[i]];}],
      ['复制',false,()=>{index=i+1;deck.pages.splice(index,0,structuredClone(deck.pages[i]));}],
      ['删除',deck.pages.length===1,()=>{deck.pages.splice(i,1);index=Math.min(i,deck.pages.length-1);}]
    ]) {
      const b=button(label,()=>{remember(label);edit();draw();changed();
        if(label==='删除')notice('已删除 1 页 · 点右上角「撤销」可以恢复');}); b.disabled=disabled; tools.append(b);
    }
    row.append(grip,tools);return row;
  }));
  bindDrag();
  list.scrollTop=scroll;
}

/* 页面拖动排序：原生 HTML5 DnD，不引依赖；上移/下移按钮保留作后备 */
let dragFrom=-1;
function clearDrop(){for(const r of $('pages').children){delete r.dataset.drop;r.classList.remove('dragging');}}
function bindDrag(){
  const rows=[...$('pages').children];
  for(const row of rows){
    row.addEventListener('dragstart',e=>{
      // 从工具按钮上拖会误触，其余位置（含标题按钮）都可以拖
      if(e.target.closest('.tools')){e.preventDefault();return;}
      dragFrom=Number(row.dataset.index);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      try{e.dataTransfer.setData('text/plain',String(dragFrom));}catch{}
    });
    row.addEventListener('dragover',e=>{
      if(dragFrom<0)return;
      e.preventDefault(); e.dataTransfer.dropEffect='move';
      const rect=row.getBoundingClientRect(), after=e.clientY>rect.top+rect.height/2;
      for(const r of rows){if(r!==row)delete r.dataset.drop;}
      row.dataset.drop=after?'after':'before';
    });
    row.addEventListener('dragleave',e=>{
      if(!row.contains(e.relatedTarget))delete row.dataset.drop;
    });
    row.addEventListener('drop',e=>{
      e.preventDefault();
      const to0=Number(row.dataset.index);
      const rect=row.getBoundingClientRect(), after=e.clientY>rect.top+rect.height/2;
      let to=after?to0+1:to0;
      const from=dragFrom;
      clearDrop(); dragFrom=-1;
      if(from<0||from===to)return;
      if(from<to)to--;
      if(to===from)return;
      remember('拖动排序');
      const [moved]=deck.pages.splice(from,1);
      deck.pages.splice(to,0,moved);
      index=to;
      draw(); changed();
      notice('已移动：第 '+(from+1)+' 页 → 第 '+(to+1)+' 位');
    });
    row.addEventListener('dragend',()=>{dragFrom=-1;clearDrop();});
  }
}
const labels={title:'标题',subtitle:'副标题',scene:'情境',question:'提问',kicker:'栏目',note:'备注',items:'条目',num:'序号',text:'内容',img:'图片',svg:'矢量图',lead:'导语',caption:'图注',duration:'时长',term:'名称',cells:'单元格（每行一格）',points:'要点',steps:'步骤',stem:'题目',answer:'答案',hint:'提示',footnote:'页脚',formula:'公式',condition:'条件',explain:'说明',closing:'结语',left:'左栏',right:'右栏',figure:'插图',verdict:'结论',tips:'提示',tasks:'任务',head:'表头',rows:'表格行',goal:'目标',why:'理由',conclusion:'结论',tag:'标签',statement:'主句',cta:'按钮文字',ctaGoto:'跳转页码',hotspots:'跳转按钮',label:'文字',goto:'跳转页码'};
/* 条目卡片的名字：用内容而不是序号，输入时实时刷新 */
let entryLabels=[];
function entrySnippet(row){
  const clean=v=>typeof v==='string'?v.replace(/<[^>]+>/g,'').trim():'';
  const pick=keys=>keys.map(k=>clean(row?.[k])).find(Boolean)||'';
  const term=pick(['term','title','heading','label','name']);
  const body=pick(['text','body','content']);
  if(term && body) return Array.from(term).slice(0,10).join('')+' · '+Array.from(body).slice(0,8).join('');
  if(term||body) return term||body;
  const rest=Object.values(row||{}).map(clean).filter(v=>v && !/^\d{1,3}$/.test(v)).sort((a,b)=>b.length-a.length);
  return rest[0]||'';
}
function refreshEntryLabels(){
  for(const {row,no,legend} of entryLabels){
    const s=entrySnippet(row);
    legend.textContent='条目 '+no+(s?' · '+s:'');
  }
}
function field(container,obj,key,title,onLive,maxOverride) {
  const label=el('label',(title || labels[key] || key)+' · '+key);
  const count=el('small'); const input=el('textarea');
  input.rows=3;input.name=key;
  input.value=Array.isArray(obj[key])?obj[key].join('\n'):obj[key]??'';
  function measure() {
    const max=maxOverride ?? pack.limits?.[key], size=Array.from(input.value).length;
    count.textContent=max?size+' / '+max+' 字':'未设字数上限';
    label.classList.toggle('over',!!max && size>max);
  }
  // 打字时只改数据 + 标记"有未保存"，不刷新预览、也不动条目名（老师要求：回车后再更新）
  // 回车（Shift+回车换行）或离开输入框 = 一次编辑结束：提交预览、更新条目名、并结束这一段撤销会话
  let dirty=false;
  const commit=()=>{
    if(!dirty)return;
    dirty=false;
    editSessions.delete(input);
    if(onLive)onLive();
    changed(0);
  };
  input.oninput=()=>{
    beginEdit(input,'编辑文字');
    obj[key]=key==='cells'?input.value.split('\n'):input.value;
    measure();
    dirty=true;
    markDirty();
  };
  input.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); commit(); } };
  input.onblur=()=>{ editSessions.delete(input); commit(); };
  trackEditSession(input);
  input.ondragover=e=>e.preventDefault();
  input.ondrop=action(async e=>{
    e.preventDefault();
    const file=e.dataTransfer.files[0];
    if (!file) return;
    const start=input.selectionStart,end=input.selectionEnd;
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
    const result=await request('/api/upload',{filename:file.name,base64:data.split(',')[1]});
    if (!input.isConnected) return notice('图片已上传，请在当前页重新插入');
    input.setRangeText('<img class="figure-img" src="'+result.path+'">',start,end,'end');input.oninput();notice('图片已插入');
  });
  measure();label.append(count,input);container.append(label);
}
/* 页面外观：背景图 + 压暗（写进 page.background / page.veil，渲染器已支持） */
function appearance(p) {
  const box=el('fieldset'); box.className='appearance';
  box.append(el('legend','页面外观'));
  const row=el('div'); row.className='appearRow';
  const state=el('span', p.background ? '已设置背景图' : '纯色底'); state.className='appearState';
  const pick=el('button','上传背景图'); pick.type='button';
  const clear=el('button','清除'); clear.type='button';
  clear.disabled=!p.background;
  const file=el('input'); file.type='file'; file.accept='image/png,image/jpeg,image/gif,image/webp'; file.hidden=true;
  row.append(pick,clear,state,file);
  box.append(row);

  const veilRow=el('label'); veilRow.className='veilRow';
  const veil=el('input'); veil.type='range'; veil.min='0'; veil.max='0.8'; veil.step='0.05';
  veil.value=String(typeof p.veil==='number'?p.veil:0.35);
  const val=el('span',Number(veil.value).toFixed(2)); val.className='veilVal';
  veilRow.append(el('span','压暗'),veil,val);
  veilRow.style.display=p.background?'':'none';
  box.append(veilRow);
  // 背景微调：模糊 / 渐变 / 放大 / 移动（没有背景图时整块隐藏）
  const fxRow=el('div'); fxRow.className='bgFx'; fxRow.hidden=!p.background;
  const mkRange=(label,min,max,step,value,apply)=>{
    const wrap=el('label'); wrap.className='veilRow';
    const input=el('input'); input.type='range'; input.min=String(min); input.max=String(max);
    input.step=String(step); input.value=String(value);
    const show=el('span',String(value)); show.className='veilVal';
    input.onpointerdown=()=>remember('调整背景');
    input.oninput=()=>{ const n=Number(input.value); show.textContent=String(n); apply(n); liveStyle({vars:bgVars(p)}); };
    input.onchange=()=>{ markDirty(); };
    wrap.append(el('span',label),input,show);
    return wrap;
  };
  fxRow.append(
    mkRange('模糊',0,24,1,Number(p.bgBlur)||0,(n)=>{p.bgBlur=n;}),
    mkRange('放大',100,200,5,Number(p.bgScale)||100,(n)=>{p.bgScale=n;}),
    mkRange('左右',-50,50,1,Number(p.bgX)||0,(n)=>{p.bgX=n;}),
    mkRange('上下',-50,50,1,Number(p.bgY)||0,(n)=>{p.bgY=n;})
  );
  const fadeLab=el('label'); fadeLab.className='veilRow';
  const fade=el('input'); fade.type='checkbox'; fade.checked=!!p.bgFade;
  fade.onchange=()=>{ remember('背景渐变'); p.bgFade=fade.checked; liveStyle({fade:p.bgFade}); markDirty(); };
  fadeLab.append(el('span','渐变模糊（边缘渐隐）'),fade);
  fxRow.append(fadeLab);
  box.append(fxRow);

  pick.onclick=()=>file.click();
  file.onchange=()=>action(async()=>{
    const f=file.files[0]; file.value=''; if(!f)return;
    const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);});
    const {path}=await request('/api/upload',{filename:f.name,base64:data.split(',')[1]});
    p.background=path; if(typeof p.veil!=='number')p.veil=0.35;
    fields(); changed();
    notice('背景图已设置 · 可拖动“压暗”调节可读性');
  })();
  veil.oninput=()=>{p.veil=Number(veil.value);val.textContent=p.veil.toFixed(2);liveStyle({veil:p.veil});};
  veil.onchange=()=>{markDirty();};
  clear.onclick=()=>{delete p.background;delete p.veil;fields();changed();notice('已清除背景图');};
  return box;
}

/* 逐条「第几次点击出现」：页级开关先物化成条目级，避免两套规则同时生效 */
function materializeBuild(page) {
  if (!page.build) return;
  const spec = layout(page);
  for (const [row, group] of buildGroups(buildRows(page, spec), true)) {
    if (row.build == null) row.build = group;
  }
  delete page.build;
  if ($('buildAll')) $('buildAll').checked = false;
}

function buildControl(page, row, groups) {
  const line = el('div'), toggle = el('input'), pick = el('select');
  line.className = 'itemBuild';
  toggle.type = 'checkbox';
  toggle.checked = groups.has(row);

  const maxGroup = Math.max(0, ...groups.values());
  const current = groups.get(row) ?? Math.min(9, maxGroup + 1);
  const upper = Math.max(3, Math.min(9, Math.max(current, maxGroup)));
  for (let i = 1; i <= upper; i++) pick.append(new Option(`第 ${i} 次`, String(i)));
  pick.value = String(current);
  pick.disabled = !toggle.checked;

  const label = el('label');
  label.append(toggle, ' 点一下出现 ');
  const groupLabel = el('label');
  groupLabel.append(pick, ' 时显示');
  line.append(label, groupLabel);

  toggle.onchange = () => {
    materializeBuild(page);
    if (toggle.checked) row.build = Number(pick.value);
    else delete row.build;
    fields();
    changed();
  };
  pick.onchange = () => {
    materializeBuild(page);
    row.build = Number(pick.value);
    fields();
    changed();
  };
  return line;
}

function fields() {
  const p=deck.pages[index], spec=layout(p), area=$('fields');
  $('buildAll').checked=!!p.build;
  showPageMotion(p);
  area.replaceChildren();
  $('current').textContent='第 '+(index+1)+' 页 · '+(spec?.name || '自定义页');
  const toggleBtn=$('toggleElastic');
  if (toggleBtn) {
    const canToggle=canToggleTemplateMode(p,pack);
    toggleBtn.hidden=!canToggle;
    if (canToggle) {
      const elastic=isElasticLayout(p.layout);
      toggleBtn.textContent=elastic?'改回保真版式':'改用弹性版式';
      toggleBtn.title=elastic
        ?'切回原 PPT 保真排版（保留文字，超出框容量的字段标红提示）'
        :'改用通用弹性版式重排本页（正文字号 ≥ 18px，不裁字）';
    }
  }
  area.append(appearance(p));
  if (!spec) {area.append(el('p',p.htmlFile?'自定义页面文件：'+p.htmlFile:'自定义页面'));if(p.html)field(area,p,'html');return;}
  const groups=buildGroups(buildRows(p,spec),p.build);

  // 给老师看的一句话：这一页点几次、每次出几条
  {
    const rows=buildRows(p,spec);
    if (rows.length) {
      const counts=new Map(); let always=0;
      for (const row of rows) {
        if (groups.has(row)) counts.set(groups.get(row),(counts.get(row)||0)+1);
        else always+=1;
      }
      const seq=[...counts.entries()].sort((a,b)=>a[0]-b[0]).map(([g,n])=>`第 ${g} 次出 ${n} 条`);
      const summary=el('p', seq.length?`本页点按：${seq.join(' → ')}${always?` · ${always} 条始终显示`:''}`:'本页条目都直接显示');
      summary.className='buildSummary';
      area.append(summary);
    }
  }
  const seen=new Set();
  entryLabels.length=0;
  for (const slot of spec.slots) {
    const [base,child]=slot.split('[].'), path=base.split('.'), key=path.pop();
    let obj=p;
    for(const part of path) obj=obj[part]??={};
    if (!child) {
      const slotMax=spec.slotSpecs?.[slot]?.max ?? pack.slots?.[p.layout]?.[slot]?.max ?? spec.slotSpecs?.[key]?.max;
      field(area,obj,key,spec.slotLabels?.[slot],undefined,slotMax);
      continue;
    }
    if (seen.has(base)) continue;
    seen.add(base);
    const group=el('fieldset');
    // 页型自带条目容量（pack.json 的 capacity，按约 30 字/条实测）：给老师一个"还能加几条"的边界
    const capacity=Number(spec.capacity?.[key])||0;
    const baseLabel=base.split('.').map(k=>labels[k]||k).join(' · ');
    group.append(el('legend',baseLabel+(capacity?`（${(obj[key]||[]).length} / 建议 ≤ ${capacity} 条）`:'')));
    const rows=obj[key]||[];
    rows.forEach((row,i)=>{
      const card=el('fieldset');
      // 条目名别只写序号：带上前 12 个字，输入时实时更新，方便在几条并列卡片里认出要改哪一条
      const legend=el('legend');
      entryLabels.push({row,no:i+1,legend});
      card.append(legend);
      for (const s of spec.slots.filter(s=>s.startsWith(base+'[].'))) {
        const childKey=s.split('[].')[1];
        const childMax=spec.slotSpecs?.[s]?.max ?? pack.slots?.[p.layout]?.[s]?.max ?? pack.limits?.[childKey];
        field(card,row,childKey,undefined,()=>refreshEntryLabels(),childMax);
      }
      card.append(button('删一条',()=>{rows.splice(i,1);fields();changed();}));group.append(card);
    });
    const full=capacity && rows.length>=capacity;
    const add=button('加一条',()=>{
      if(capacity && rows.length>=capacity)notice(`这一页建议最多 ${capacity} 条，再加会挤出版面——先「自检」看溢出，或拆成两页 / 换个更宽的页型`);
      (obj[key]??=[]).push({});fields();changed();
    });
    if(full){add.classList.add('over');add.title=`已到建议上限 ${capacity} 条`;}
    group.append(add);
    // 一键拆页：超过容量时把一半条目搬到下一页（同页型），省得手工复制整页再逐条删
    if(rows.length>2){
      group.append(button('拆成两页',()=>{
        const all=obj[key];
        const cap=capacity||Math.ceil(all.length/2);
        const keep=Math.max(1,Math.min(cap,Math.ceil(all.length/2)));
        if(all.length-keep<1)return notice('条目太少，不用拆');
        remember('拆成两页');
        const rest=all.splice(keep);
        const page=deck.pages[index];
        const copy=structuredClone(page);
        copy[key]=rest;
        delete copy.notes;
        if(copy.title)copy.title=String(copy.title).replace(/（续）$/,'')+'（续）';
        deck.pages.splice(index+1,0,copy);
        draw();changed();
        notice(`已拆成两页：本页 ${all.length} 条，下一页 ${rest.length} 条`);
      }));
    }
    if(full)group.append(el('p',`已到建议上限 ${capacity} 条；再加建议先拆页`));
    area.append(group);
  }
  refreshEntryLabels();
}
if ($('toggleElastic')) {
  $('toggleElastic').onclick=action(async()=>{
    const p=deck?.pages?.[index];
    if (!p || !canToggleTemplateMode(p,pack)) return;
    const wasElastic=isElasticLayout(p.layout);
    remember(wasElastic?'改回保真版式':'改用弹性版式');
    const res=toggleTemplateMode(p,pack,index);
    if (!res) return;
    draw();
    await changed(0);
    notice((res.mode==='elastic'?'已改用弹性版式':'已改回保真版式')+' · 内容已保留，可撤销');
  });
}
function showPageMotion(page) {
  const anim=page.anim ?? 'none';
  $('pageAnim').value=anim;
  $('pageStagger').value=page.stagger ?? 0;
  $('pageSpeed').value=page.speed ?? 260;
  $('pageStagger').disabled=$('pageSpeed').disabled=anim==='none';
}
$('deckTransition').onchange=action(async()=>{
  if(!deck)return;
  remember('修改页面切换');
  deck.transition=$('deckTransition').value;
  await changed(0);
});
for(const [id,key] of [['pageAnim','anim'],['pageStagger','stagger'],['pageSpeed','speed']]) {
  $(id).onchange=action(async()=>{
    if(!deck)return;
    remember('修改元素入场');
    const page=deck.pages[index], value=$(id).value;
    if(key==='anim' && value==='none'){
      delete page.anim;
      delete page.stagger;
      delete page.speed;
      if(!deck.transition && !deck.pages.some(p=>p.anim || p.stagger != null || p.speed != null)){
        deck.transition='fade';
      }
    } else {
      page[key]=key==='anim' ? value : Number(value);
    }
    showPageMotion(page);
    await changed(0);
  });
}
const deckSettings = {theme:$('deckTheme'),font:$('deckFont')};
for (const [key, select] of Object.entries(deckSettings)) {
  select.onchange=action(async()=>{
    if (!deck) return;
    remember(key==='theme'?'修改课件主题':'修改课件字体');
    if (select.value) deck[key]=select.value;
    else delete deck[key];
    draw();
    await changed(0);
  });
}
if ($('pageTheme')) {
  $('pageTheme').onchange=action(async()=>{
    if (!deck) return;
    remember('修改本页主题');
    const p=deck.pages[index];
    if ($('pageTheme').value) p.theme=$('pageTheme').value;
    else delete p.theme;
    await changed(0);
  });
}
const textbookInputs=document.querySelectorAll('[data-book]');
for(const input of textbookInputs){
  input.oninput=()=>{
    beginEdit(input,'编辑教材信息');
    const textbook=((deck.meta??={}).textbook??={});
    if(input.value) textbook[input.dataset.book]=input.value;
    else delete textbook[input.dataset.book];
    changed();
  };
  trackEditSession(input);
}
function notesState(p){
  const count=Array.from((p.notes||'').replace(/\s/g,'')).length;
  const bp=p.textbookPages?.trim();
  $('notesState').textContent=(count?count+' 字':'未写')+(Number.isFinite(p.minutes)?' · '+p.minutes+' 分钟':'')+(bp?' · 教材 '+bp:'');
}
$('teacherNotes').oninput=()=>{
  beginEdit($('teacherNotes'),'编辑讲稿');
  const p=deck.pages[index], hadNotes=Boolean(p.notes?.trim());
  if($('teacherNotes').value) p.notes=$('teacherNotes').value;
  else delete p.notes;
  if(hadNotes!==Boolean(p.notes?.trim())) outline();
  notesState(p);changed();
};
$('minutes').oninput=()=>{
  const p=deck.pages[index], input=$('minutes');
  beginEdit(input,'编辑用时');
  if(input.validity.valid && Number.isFinite(input.valueAsNumber)) p.minutes=input.valueAsNumber;
  else delete p.minutes;
  notesState(p);changed();
};
if ($('pageBookPages')) {
  $('pageBookPages').oninput=()=>{
    const p=deck.pages[index], input=$('pageBookPages');
    beginEdit(input,'编辑本页教材页码');
    if(input.value.trim()) p.textbookPages=input.value.trim();
    else delete p.textbookPages;
    notesState(p);changed();
  };
  trackEditSession($('pageBookPages'));
}
trackEditSession($('minutes'));
trackEditSession($('teacherNotes'));
function showNotesMenu(open){
  $('notesMenu').hidden=!open;
  $('exportNotes').setAttribute('aria-expanded',String(open));
}
$('exportNotes').onclick=()=>showNotesMenu($('notesMenu').hidden);
document.addEventListener('click',e=>{
  if(!e.target.closest('.notesExport'))showNotesMenu(false);
});
window.addEventListener('blur',()=>showNotesMenu(false));
$('notesMenu').onclick=action(async e=>{
  const format=e.target.closest('button')?.dataset.format, key=name;
  if(!format)return;
  showNotesMenu(false);
  $('exportNotes').focus();
  if(!deck)return;
  const response=await fetch(url('notes-'+format,key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(deck)});
  if(!response.ok)throw Error((await response.json()).error);
  const a=el('a');a.href=URL.createObjectURL(await response.blob());
  a.download=key+'-讲稿.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});

function draw(){
  // 重建表单会丢滚动位置：记住再放回去，老师改页面下半部分时不会被弹回顶部
  const panel=$('fields').closest('.panel');
  const scroll=panel?.scrollTop ?? 0;
  showMaterialCount(deck.materials?.length || 0);
  const p=deck.pages[index];
  $('deckTransition').value=deck.transition ?? 'fade';
  if ($('pageTheme')) $('pageTheme').value=p.theme||'';
  $('teacherNotes').value=p.notes||'';
  $('minutes').value=p.minutes??'';
  if ($('pageBookPages')) $('pageBookPages').value=p.textbookPages||'';
  notesState(p);
  for(const input of textbookInputs) input.value=deck.meta?.textbook?.[input.dataset.book]||'';
  for(const [key,select] of Object.entries(deckSettings)) select.value=deck[key]||'';
  outline();
  if (!editor.classList.contains('block-mode')) fields();
  $('undo').disabled=!histories.get(name)?.length;
  syncPageScale();
  if(panel) panel.scrollTop=scroll;
}
let draftAbort = null;
async function preview(delay=0, targetIndex=index) {
  selectedBlock=null;
  pendingReplacement=null;
  syncAssetReplaceButton();
  clearTimeout(timer);
  timer=null;
  gotoTarget=-1;
  if (draftAbort) { draftAbort.abort(); draftAbort = null; }
  const version=++revision, snapSeq=editSeq, target=targetIndex, due=performance.now()+delay;
  async function prepare() {
    timer=null;
    const ctrl = new AbortController();
    draftAbort = ctrl;
    let res;
    try {
      const r = await fetch(url('draft'), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(deck), signal: ctrl.signal });
      res = await r.json();
      if (!r.ok) throw Error(res.error || '操作失败');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      throw err;
    } finally {
      if (draftAbort === ctrl) draftAbort = null;
    }
    const {token,tweakWarnings} = res;
    if(version!==revision)return;
    previewedSeq=snapSeq;
    if(tweakWarnings?.length) notice(tweakWarnings.join('\n'));
    const show=()=>{
      timer=null;
      if(version!==revision)return;
      loadedRevision=0;
      gotoTarget=target;
      const nextUrl=url('preview')+'&draft='+token+'&editorPreview='+version+'#'+(target+1);
      const hasEmbed = Boolean(deck?.pages?.some(p => p.freeBlocks?.some(b => b.embedUrl)));
      const sandboxVal = hasEmbed ? 'allow-scripts allow-same-origin allow-forms allow-popups' : 'allow-scripts';
      // 首帧直接加载到主画布；后续刷新（撤销/改字/换主题）按需建后台缓冲预渲染，就绪后 0ms 瞬切并移除旧帧
      if (!$('frame').getAttribute('src')) {
        $('frame').setAttribute('sandbox', sandboxVal);
        $('frame').src=nextUrl;
        return;
      }
      const prevBuf=$('frameBuffer');
      if (prevBuf) prevBuf.remove();
      const buf=document.createElement('iframe');
      buf.id='frameBuffer';
      buf.setAttribute('sandbox', sandboxVal);
      buf.setAttribute('aria-hidden','true');
      buf.tabIndex=-1;
      buf.title='课件放映预览';
      buf.addEventListener('load', onPreviewFrameLoad);
      $('stage').append(buf);
      buf.src=nextUrl;
    };
    if(delay)timer=setTimeout(show,Math.max(0,due-performance.now()));else show();
  }
  if(!delay)return prepare();
  timer=setTimeout(action(prepare),Math.min(delay,220));
}

/* 预览控制：点画面/按钮都能翻页，全屏预览整份课件 */
const postPreview=(kind,extra={})=>{try{$('frame').contentWindow?.postMessage({ck:kind,...extra},'*');}catch{}};
const tweakCounts = new Map();
const editor = document.querySelector('.editor');
const fieldPanel = editor.querySelector('.panel');
let panelScroll = 0;
let selectedFree, formBlock;
let selectedBlock=null, pendingReplacement=null;
const replacementAssetPattern = /^\.\.\/assets\/([\p{L}\p{N}_-]+)\/(img-\d+\.(?:png|jpe?g|gif|webp|bmp))$/iu;
function validReplacementTarget(target) {
  return !!target && typeof target === 'object' && validTweak({
    path:target.path, kind:target.kind, targetKey:target.targetKey
  }) && [target.x,target.y,target.w,target.h].every(Number.isFinite) && target.w>0 && target.h>0;
}
function replacementAssetPath(src) {
  const match=typeof src==='string'&&replacementAssetPattern.exec(src);
  return match ? match[1]+'/'+match[2] : '';
}
function sameReplacementTarget(a,b) {
  return validReplacementTarget(a)&&validReplacementTarget(b)&&a.kind===b.kind&&
    a.targetKey===b.targetKey&&a.path.length===b.path.length&&a.path.every((value,i)=>value===b.path[i]);
}
function syncAssetReplaceButton() {
  const button=$('assetReplace');
  if(!button)return;
  const multi=assetPickMode==='ai'||assetPickMode==='gen'||assetPickMode==='hw';
  button.hidden=!$('blockMode').checked||multi||!selectedBlock||selectedBlock.index!==index||!pickedAsset||!replacementAssetPath('../assets/'+pickedRef+'/'+pickedAsset.file);
  button.disabled=!!pendingReplacement;
}
function freeBlock() {
  return deck?.pages[index]?.freeBlocks?.find(b=>b.id===selectedFree);
}

/* 图片效果的 CSS 字符串（与渲染器同一套规则） */
function freeImageCss(b) {
  const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const bright = num(b.bright, 50, 200, 100), contrast = num(b.contrast, 50, 200, 100);
  const saturate = num(b.saturate, 0, 200, 100), blur = num(b.blur, 0, 12, 0);
  const radius = num(b.radius, 0, 200, 0), opacity = num(b.opacity, 10, 100, 100), rotate = num(b.rotate, -45, 45, 0);
  const filters = [];
  if (bright !== 100) filters.push('brightness(' + bright + '%)');
  if (contrast !== 100) filters.push('contrast(' + contrast + '%)');
  if (saturate !== 100) filters.push('saturate(' + saturate + '%)');
  if (blur) filters.push('blur(' + blur + 'px)');
  const transforms = [];
  if (rotate) transforms.push('rotate(' + rotate + 'deg)');
  if (b.flipH) transforms.push('scaleX(-1)');
  if (b.flipV) transforms.push('scaleY(-1)');
  return [
    filters.length ? 'filter:' + filters.join(' ') : '',
    transforms.length ? 'transform:' + transforms.join(' ') : '',
    radius ? 'border-radius:' + radius + 'px' : '',
    opacity !== 100 ? 'opacity:' + opacity / 100 : '',
    b.shadow ? 'box-shadow:0 12px 32px rgba(0,0,0,.35)' : '',
    b.border ? 'outline:2px solid rgba(255,255,255,.85)' : '',
    b.fit === 'cover' ? 'object-fit:cover' : '',
  ].filter(Boolean).join(';');
}

function applyTemplateBlockPatch(target, patch, label, skipRemember = false) {
  const page = deck?.pages?.[index];
  if (!page || !target?.path) return;
  if (!skipRemember) remember(label || '块属性微调');
  const nextTweaks = mergeBlockTweak(page.blockTweaks, {
    path: target.path,
    kind: target.kind,
    targetKey: target.targetKey,
    ...patch,
  });
  if (nextTweaks.length) page.blockTweaks = nextTweaks;
  else delete page.blockTweaks;
  markDirty();
  try {
    $('frame').contentWindow?.postMessage({
      ck: 'blockStyle',
      editorPreview: String(revision),
      path: target.path,
      style: patch,
    }, '*');
  } catch {}
  if (patch.hidden) {
    selectedBlock = null;
    syncAssetReplaceButton();
  }
  formBlock = null;
  showFreeForm();
}

function appendFreeLayerControls(form, b) {
  const layerGroup = el('div');
  layerGroup.className = 'pptGroup';
  const curZ = Number.isSafeInteger(b.z) ? b.z : 0;
  const lbl = el('span', '图层顺序（当前 ' + (curZ >= 0 ? '+' + curZ : curZ) + '）');
  lbl.className = 'pptLabel';
  const seg = el('div');
  seg.className = 'pptSeg';
  for (const [title, nextZ] of [['置顶', 20], ['上移', Math.min(50, curZ + 1)], ['下移', Math.max(-10, curZ - 1)], ['置底', -5]]) {
    seg.append(button(title, () => {
      remember('调整自由块图层');
      b.z = nextZ;
      formBlock = null;
      showFreeForm();
      return changed(0);
    }));
  }
  layerGroup.append(lbl, seg);
  form.append(layerGroup);
}

function showFreeForm() {
  const inTweak = $('blockMode').checked;
  const b = inTweak && freeBlock();
  const page = deck?.pages?.[index];
  const tplBlock = inTweak && !b && selectedBlock && selectedBlock.index === index ? selectedBlock : null;
  const hiddenList = inTweak && page ? hiddenBlocksOf(page) : [];
  editor.classList.toggle('has-free-text', inTweak);
  $('deleteFree').disabled = !b;
  const form = $('freeForm');
  form.hidden = !inTweak;
  if (form.hidden) { formBlock = null; return; }
  if (b && formBlock === b) return;
  formBlock = b || null;
  form.replaceChildren();
  if (b && b.type === 'widget') {
    const head = el('div'); head.className = 'pptHead';
    head.append(el('strong', '交互演示块'), el('small', Math.round(b.w) + '×' + Math.round(b.h)));
    form.append(head);
    const scaleGroup = el('div'); scaleGroup.className = 'pptGroup';
    const curScale = Number.isFinite(b.contentScale) ? b.contentScale : 100;
    const scaleLbl = el('span', '内容缩放（防裁切：' + curScale + '%）'); scaleLbl.className = 'pptLabel';
    const scaleInput = el('input'); scaleInput.type = 'range'; scaleInput.min = '45'; scaleInput.max = '100'; scaleInput.step = '5'; scaleInput.value = String(curScale);
    scaleInput.oninput = () => { scaleLbl.textContent = '内容缩放（防裁切：' + scaleInput.value + '%）'; };
    scaleInput.onchange = action(async () => {
      remember('调整演示块内容缩放');
      b.contentScale = Number(scaleInput.value);
      if (b.contentScale >= 100) delete b.contentScale;
      await changed(0);
    });
    scaleGroup.append(scaleLbl, scaleInput);
    form.append(scaleGroup);
    form.append(button('一键铺满画面', () => {
      remember('演示块铺满画面');
      Object.assign(b, { x: 40, y: 40, w: 1200, h: 640 });
      formBlock = null;
      showFreeForm();
      return changed(0);
    }));
    appendFreeLayerControls(form, b);
    form.append(button('删除此演示块', deleteFree));
    return;
  }
  if (b && b.type === 'image') {
    // 效果面板：第一项保持亮度滑杆（兼容回归测试），全部落到 CSS，即时生效、一步撤销
    const row=(label,node)=>{const w=el('label');w.append(el('span',label),node);form.append(w);return w;};
    const range=(key,label,min,max,step,dflt,unit)=>{
      let touched=false;
      const input=el('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);
      input.value=String(Number.isFinite(b[key])?b[key]:dflt);
      const show=el('span',input.value+(unit||''));
      input.onpointerdown=()=>{touched=false;};
      input.oninput=()=>{
        if(!touched){remember('调整图片效果');touched=true;}
        b[key]=input.valueAsNumber;
        show.textContent=input.value+(unit||'');
        // 拖动中只就地改样式，不重载预览（重载会重放入场动画）
        try{$('frame').contentWindow?.postMessage({ck:'imgFx',editorPreview:String(revision),id:b.id,css:freeImageCss(b)},'*');}catch{}
      };
      input.onchange=()=>{ if(!touched)remember('调整图片效果'); touched=false; markDirty(); };
      const w=row(label,input);w.append(show);
    };
    range('bright','亮度',50,150,1,100,'%');
    range('contrast','对比',50,150,1,100,'%');
    range('saturate','饱和',0,200,1,100,'%');
    range('blur','模糊',0,12,1,0,'px');
    range('radius','圆角',0,120,1,0,'px');
    range('opacity','不透明',30,100,1,100,'%');
    range('rotate','旋转',-30,30,1,0,'°');
    const check=(key,label)=>{const lab=el('label');const input=el('input');input.type='checkbox';input.checked=!!b[key];
      input.onchange=()=>{remember('图片效果');b[key]=input.checked;changed(0);};lab.append(input,el('span',label));form.append(lab);};
    check('flipH','左右翻转');check('flipV','上下翻转');check('shadow','阴影');check('border','白描边');
    const fitRow=el('label');const fit=el('select');fit.append(new Option('完整显示','contain'),new Option('填满裁切','cover'));
    fit.value=b.fit==='cover'?'cover':'contain';
    fit.onchange=()=>{remember('图片裁切方式');b.fit=fit.value;changed(0);};
    fitRow.append(el('span','裁切'),fit);form.append(fitRow);
    appendFreeLayerControls(form, b);
    form.append(button('换一张图',()=>openAssets('replaceFree')));
    return;
  }
  if (b && b.type === 'text') {
    for (const [key,title] of [['text','文字'],['size','字号'],['align','对齐'],['weight','加粗']]) {
      const input=el(key==='text'?'textarea':key==='align'?'select':'input');
      if (key==='align') input.append(...['左对齐','居中','右对齐'].map((t,i)=>new Option(t,['left','center','right'][i])));
      if (key==='size') { input.type='number';input.min=1; }
      if (key==='weight') {input.type='checkbox';input.checked=b.weight===700;}
      else input.value=b[key] ?? ({size:32,align:'left',text:''})[key];
      let touched=false;
      input.onblur=()=>{touched=false;};
      input.oninput=()=>{
        if (key==='size' && !(input.valueAsNumber>0)) return;
        if (!touched) remember('编辑自由文字');
        touched=key==='text'||key==='size';
        b[key]=key==='weight'?(input.checked?700:400):key==='size'?input.valueAsNumber:input.value;
        changed();
      };
      const label=el('label',title);label.append(input);form.append(label);
    }
    const swWrap = el('div'); swWrap.className = 'pptGroup';
    const swLbl = el('span', '文字颜色'); swLbl.className = 'pptLabel';
    const swRow = el('div'); swRow.className = 'pptSwatches';
    for (const s of SWATCH_COLORS) {
      const sb = el('button'); sb.type = 'button'; sb.className = 'pptSwatch' + ((b.color || '').toLowerCase() === s.hex ? ' active' : '');
      sb.style.background = s.hex; sb.title = s.name;
      sb.onclick = () => { remember('修改自由文字颜色'); b.color = s.hex; formBlock = null; showFreeForm(); changed(0); };
      swRow.append(sb);
    }
    swWrap.append(swLbl, swRow);
    form.append(swWrap);
    appendFreeLayerControls(form, b);
    return;
  }
  if (tplBlock) {
    let colorSession = false;
    renderTemplateBlockInspector(form, {
      target: tplBlock,
      page,
      onPatch: (patch, label, continuous = false) => {
        const skipRemember = continuous && colorSession;
        if (continuous) colorSession = true;
        else colorSession = false;
        applyTemplateBlockPatch(tplBlock, patch, label, skipRemember);
      },
      onUnhide: (pathArr) => {
        applyTemplateBlockPatch({ path: pathArr, kind: 'card' }, { hidden: false }, '恢复显示元素');
      },
      onReset: () => {
        remember('恢复块默认样式');
        const key = tplBlock.path.join('.');
        page.blockTweaks = (page.blockTweaks || []).filter((t) => t.path?.join('.') !== key);
        if (!page.blockTweaks.length) delete page.blockTweaks;
        formBlock = null;
        changed(0);
      },
      onReplaceImage: () => openAssets(''),
    });
    return;
  }
  if (hiddenList.length) {
    const box = el('div'); box.className = 'pptGroup pptHiddenBox';
    const title = el('span', `本页已隐藏 (${hiddenList.length})`); title.className = 'pptLabel';
    box.append(title);
    for (const h of hiddenList) {
      const r = el('div'); r.className = 'pptHiddenRow';
      r.append(el('small', `#${h.path.join('.')}`), button('显示', () => {
        applyTemplateBlockPatch({ path: h.path, kind: h.kind }, { hidden: false }, '恢复显示元素');
      }));
      box.append(r);
    }
    form.append(box);
    return;
  }
  const empty = el('div'); empty.className = 'pptEmpty';
  empty.append(
    el('b', '版面属性栏'),
    document.createTextNode('点击画面上的标题、段落、卡片或图片，可调节字号、颜色、对齐、图层与显隐；双击文字可直接修改。')
  );
  form.append(empty);
}
function addFree(type,src) {
  const page=deck.pages[index];
  remember('添加自由块');
  const b={id:crypto.randomUUID(),type,x:480,y:type==='image'?270:420,w:320,h:type==='image'?180:90};
  Object.assign(b,type==='image'?{src}:{text:'新文字',size:32,align:'left',weight:400});
  (page.freeBlocks??=[]).push(b);
  selectedFree=b.id; showFreeForm(); return changed(0);
}
function deleteFree() {
  const b=freeBlock(); if (!b) return;
  remember('删除自由块');
  const page=deck.pages[index];
  page.freeBlocks=page.freeBlocks.filter(item=>item!==b);
  if (!page.freeBlocks.length) delete page.freeBlocks;
  selectedFree=null;showFreeForm();return changed(0);
}
$('deleteFree').onclick=action(deleteFree);
$('addText').onclick=action(()=>addFree('text'));
$('addImage').onclick=()=>$('assets').click();
function syncBlockMode() {
  const enabled = $('blockMode').checked;
  if ($('modeContentTab')) {
    $('modeContentTab').classList.toggle('is-active', !enabled);
    $('modeContentTab').setAttribute('aria-selected', String(!enabled));
  }
  if ($('modeTweakTab')) {
    $('modeTweakTab').classList.toggle('is-active', enabled);
    $('modeTweakTab').setAttribute('aria-selected', String(enabled));
  }
  if (enabled !== editor.classList.contains('block-mode')) {
    if (enabled) panelScroll = fieldPanel.scrollTop;
    editor.classList.toggle('block-mode', enabled);
  if ($('blockEditHint')) $('blockEditHint').hidden = !enabled;
    if (!enabled) { fields(); fieldPanel.scrollTop = panelScroll; }
  }
  if (!enabled) { selectedFree=null; selectedBlock=null; pendingReplacement=null; syncAssetReplaceButton(); }
  $('blockEditHint').hidden=!enabled;
  showFreeForm();
  void $('frame').offsetWidth;
  const expectedW = Math.round($('frame').clientWidth) || 0;
  const expectedH = Math.round($('frame').clientHeight) || 0;
  $('previewHint').textContent = enabled ? '拖动吸附 · 双击文字改内容' : '点画面＝下一步';
  $('frame').contentWindow?.postMessage({ck:'blockMode', enabled, expectedW, expectedH, freeId:freeBlock()?.id, editorPreview:String(revision)}, '*');
}
$('blockMode').onchange = syncBlockMode;
if ($('modeContentTab')) {
  $('modeContentTab').onclick = () => {
    if ($('blockMode').checked) {
      $('blockMode').checked = false;
      syncBlockMode();
    }
  };
}
function promoteBufferFrame(targetFrame, ep) {
  if (!targetFrame || targetFrame.id !== 'frameBuffer') return;
  if (targetFrame._failTimer) { clearTimeout(targetFrame._failTimer); targetFrame._failTimer = null; }
  if (ep !== revision) { targetFrame.remove(); return; }
  const oldFrame = $('frame');
  targetFrame.id = 'frame';
  targetFrame.removeAttribute('aria-hidden');
  targetFrame.removeAttribute('tabindex');
  if (oldFrame && oldFrame !== targetFrame) oldFrame.remove();
  loadedRevision = revision;
  syncBlockMode();
  try{$('frame').contentWindow?.postMessage({ck:'full',on:$('stage').classList.contains('full')},'*');}catch{}
}
function onPreviewFrameLoad(e) {
  const targetFrame = e.currentTarget;
  const rawSrc = targetFrame.getAttribute('src');
  if (!rawSrc || rawSrc === 'about:blank') return;
  const ep = Number(new URL(targetFrame.src, location.origin).searchParams.get('editorPreview'));
  if (!ep) return;
  if (targetFrame.id === 'frameBuffer') {
    if (ep !== revision) { targetFrame.remove(); return; }
    // 等待缓冲帧内的 runtime.js 发出 ck:'page' 就绪消息再换帧；若为 HTTP 400/500 错误页则 250ms 后丢弃并保留旧画面
    targetFrame._failTimer = setTimeout(() => {
      if (targetFrame.id === 'frameBuffer') {
        targetFrame.remove();
        notice('预览加载失败，已保留原画面');
      }
    }, 250);
    return;
  }
  if (ep === revision) loadedRevision = revision;
  syncBlockMode();
  try{$('frame').contentWindow?.postMessage({ck:'full',on:$('stage').classList.contains('full')},'*');}catch{}
}
$('frame').addEventListener('load', onPreviewFrameLoad);

/* 画面上双击改字：按 data-ck-f 的路径写回页面数据（支持 items[2].term 这种） */
function applyInlineField(data) {
  const path = typeof data?.path === 'string' ? data.path : '';
  const text = typeof data?.text === 'string' ? data.text : '';
  if (!path || !deck?.pages?.[index]) return;
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let holder = deck.pages[index];
  for (let i = 0; i < tokens.length - 1; i += 1) holder = holder?.[tokens[i]];
  const leaf = tokens[tokens.length - 1];
  if (!holder || leaf === undefined || !(leaf in holder)) return;
  if (String(holder[leaf] ?? '') === text) return;
  remember('编辑文字');
  holder[leaf] = text;
  draw();
  changed(0);
  notice('已更新「' + path + '」');
}
function commitBlock(tweak) {
  if (!validTweak(tweak)) return;
  const page = deck.pages[index];
  remember('块级微调');
  const nextTweaks = mergeBlockTweak(page.blockTweaks, tweak);
  if (nextTweaks.length) page.blockTweaks = nextTweaks;
  else delete page.blockTweaks;
  markDirty();
  const key = JSON.stringify([name, page.layout || 'custom']);
  histories.get(name).at(-1).tweakKey = key;
  const count = (tweakCounts.get(key) || 0) + 1;
  tweakCounts.set(key, count);
  if (count === 3) notice('可以存成新页型');
}
function applyBlockReplacement(data) {
  const pending=pendingReplacement;
  if (!pending||data.requestId!==pending.requestId)return;
  pendingReplacement=null;
  syncAssetReplaceButton();
  // iframe 回包把 target 字段摊平在同层，这里两种形状都接受
  const target=data.target || {path:data.path,kind:data.kind,targetKey:data.targetKey,x:data.x,y:data.y,w:data.w,h:data.h};
  if (!pending.page||deck.pages[pending.index]!==pending.page||index!==pending.index||
      !$('blockMode').checked||selectedBlock?.index!==pending.index||
      !sameReplacementTarget(target,pending.target)||!sameReplacementTarget(target,selectedBlock)||
      !replacementAssetPath(data.src)||data.src!==pending.src||
      ![target.x,target.y,target.w,target.h].every(Number.isFinite)||target.w<=0||target.h<=0||
      !Number.isFinite(pending.width)||pending.width<=0||!Number.isFinite(pending.height)||pending.height<=0) return;
  const imageHeight=target.w*pending.height/pending.width;
  if(!Number.isFinite(imageHeight)||imageHeight<=0)return;
  const page=pending.page;
  const pathKey=target.path.join('.');
  const tweaks=page.blockTweaks||[];
  const previous=tweaks.find(item=>item.path?.join('.')===pathKey&&item.kind===target.kind&&
    (!item.targetKey||item.targetKey===target.targetKey));
  const hiddenTweak={...previous,path:[...target.path],kind:target.kind,targetKey:target.targetKey,hidden:true};
  const remaining=tweaks.filter(item=>item.path?.join('.')!==pathKey);
  remaining.push(hiddenTweak);
  const id=crypto.randomUUID();
  remember('替换块');
  page.blockTweaks=remaining;
  (page.freeBlocks??=[]).push({id,type:'image',x:target.x,y:target.y,w:target.w,h:imageHeight,src:replacementAssetPath(data.src)});
  selectedFree=id;
  selectedBlock=null;
  showFreeForm();
  syncAssetReplaceButton();
  $('assetsDialog').close();
  changed(0);
  notice('已替换选中的块 · 可撤销');
}
window.addEventListener('message',({source,data})=>{
  const bufFrame = $('frameBuffer');
  if (bufFrame && source === bufFrame.contentWindow && data?.ck === 'page') {
    const ep = Number(data?.editorPreview);
    if (ep === revision) promoteBufferFrame(bufFrame, ep);
    return;
  }
  if(source!==$('frame').contentWindow)return;
  // Esc 是"意图"而不是"数据"：改完动效会重载预览、版本号在飞行途中就变了，
  // 所以它不能受版本守卫约束，否则全屏里按 Esc 会被静默丢弃。
  if (data?.ck === 'freeImageEdit') {
    const id = String(data.id || '');
    const page = deck?.pages?.[index];
    const block = page?.freeBlocks?.find((item) => item.id === id);
    if (block) { selectedFree = id; showFreeForm(); openAssets('replaceFree'); }
    return;
  }
  if (data?.ck === 'blockEscape') {
    if ($('stage').classList.contains('full')) fullPreview(false);
    return;
  }
  if (data?.ck === 'esc' || data?.ck === 'exitFull') {
    if ($('stage').classList.contains('full')) fullPreview(false);
    return;
  }
  if (data?.editorPreview!==String(revision))return;
  if ($('blockMode').checked && data.index===index) {
    if (data.ck==='freeSelection') {
      selectedFree=data.id;
      if (selectedFree) selectedBlock=null;
      syncAssetReplaceButton();
      showFreeForm();
      return;
    }
    if (data.ck==='blockSelection') {
      selectedBlock=validReplacementTarget(data.target)?{...data.target,index}:null;
      if (selectedBlock) selectedFree=null;
      syncAssetReplaceButton();
      showFreeForm();
      return;
    }
    const b=freeBlock();
    if (b && data.id===b.id) {
      if (data.ck==='freeDelete') { action(deleteFree)();return; }
      if (data.ck==='freeGeometry' && [data.x,data.y,data.w,data.h].every(Number.isFinite) && data.w>0 && data.h>0) {
        remember('微调自由块');Object.assign(b,{x:data.x,y:data.y,w:data.w,h:data.h});markDirty();return;
      }
    }
  }
  if (data.ck === 'blockCommit' && data.index === index) {
    commitBlock(data.tweak);
    if (validReplacementTarget(data.target)) selectedBlock={...data.target,index};
    syncAssetReplaceButton();return;
  }
  if (data.ck === 'fieldEdit' && data.index === index) {
    applyInlineField(data);
    return;
  }
  if (data.ck === 'blockReplacement' && data.index === index) { applyBlockReplacement(data); return; }
  if (data.ck === 'blockUndo') { $('undo').click(); return; }
  if (data.ck === 'blockSave') { $('save').click(); return; }
  if (data.ck !== 'page') return;
  loadedRevision = revision;
  syncBlockMode();
  const i=data.index, list=$('pages');
  if(!Number.isInteger(i) || i<0 || i>=list.children.length)return;
  if (gotoTarget >= 0) {
    if (i === gotoTarget) gotoTarget = -1;
    return;
  }
  // 自动保存会重载预览、预览又回报当前页：同一页就别重建表单，否则正在输入的内容会丢焦点
  if (i === index) return;
  index=i;
  showFreeForm();draw();
  list.children[i].scrollIntoView({block:'nearest',inline:'nearest'});
});
function fullPreview(on){
  const stage=$('stage');
  if(on===undefined)on=!stage.classList.contains('full');
  stage.classList.toggle('full',on);
  if($('exitFullBtn'))$('exitFullBtn').hidden=!on;
  const fullLabel=$('pFull').querySelector('.btnLabel')||$('pFull');
  fullLabel.textContent=on?'退出全屏':'全屏预览';
  $('pFull').title=on?'退出全屏（Esc）':'全屏预览（Esc 退出）';
  $('pFull').classList.toggle('primary',on);
  // 告诉 iframe 现在是不是全屏预览：它按 Esc 时才会先请求退出全屏，而不是切总览
  try{$('frame').contentWindow?.postMessage({ck:'full',on:$('stage').classList.contains('full')},'*');}catch{}
}
if($('exitFullBtn'))$('exitFullBtn').onclick=()=>fullPreview(false);
$('pNext').onclick=()=>{gotoTarget=-1;postPreview('next');};
$('pPrev').onclick=()=>{gotoTarget=-1;postPreview('prev');};
$('pOverview').onclick=()=>{gotoTarget=-1;postPreview('overview');};
$('pFull').onclick=()=>fullPreview();
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('notesMenu').hidden){
    showNotesMenu(false); $('exportNotes').focus(); return;
  }
  if(e.key==='Escape'&&$('stage').classList.contains('full')){
    fullPreview(false); return;
  }
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&!e.isComposing){
    const key=e.key.toLowerCase();
    if(key==='s'){
      e.preventDefault();
      if(deck&&!document.querySelector('dialog[open]'))$('save').click();
    }
    if(key==='z'&&deck&&!document.querySelector('dialog[open]')&&!e.target.closest?.('input, textarea, select')&&!e.target.isContentEditable){
      e.preventDefault(); $('undo').click();
    }
  }
  if ($('blockMode').checked && freeBlock() && ['Backspace','Delete'].includes(e.key) &&
      !document.querySelector('dialog[open]') && !e.target.closest?.('input,textarea,select,[contenteditable=true]')) {
    e.preventDefault();action(deleteFree)();
  }
  if(e.key==='Escape'&&$('stage').classList.contains('full')){e.preventDefault();fullPreview(false);}
});
/* 拖动滑杆时把样式即时打到预览，不重载 iframe（重载会白闪一下） */
function liveStyle(style) {
  try { $('frame').contentWindow?.postMessage({ ck: 'liveStyle', editorPreview: String(revision), style }, '*'); } catch {}
}
function bgVars(p) {
  return {
    '--bg-blur': (Number(p.bgBlur) || 0) + 'px',
    '--bg-scale': String((Number(p.bgScale) || 100) / 100),
    '--bg-x': (Number(p.bgX) || 0) + '%',
    '--bg-y': (Number(p.bgY) || 0) + '%',
  };
}
function markDirty() {
  editSeq++;
  $('status').textContent='有未保存的修改';
  working.set(name,{deck,pack,dirty:true});syncDirtyMark();
}
function changed(delay=800) {
  outline();markDirty();return preview(delay);
}
/* 结构性操作（加页/删页/复制/移动）也进历史，撤销才覆盖得到 */
function remember(label){
  const history=histories.get(name)||[];
  history.push({deck:structuredClone(deck),index,label});
  while(history.length>10)history.shift();
  histories.set(name,history);
  $('undo').disabled=false;
}
/* 一次「编辑会话」记一步历史：聚焦后第一次输入时快照，失焦后再输入算新的一步。
   每个字符都克隆整份课件太贵；而没有这一步，纯文字编辑就完全撤销不了。 */
const editSessions=new WeakSet();
function beginEdit(el,label){
  if(editSessions.has(el))return;
  editSessions.add(el);
  remember(label);
}
function trackEditSession(el){
  el.addEventListener('blur',()=>editSessions.delete(el));
}
$('add').onclick=action(()=>{remember('加页');index=deck.pages.push({layout:$('layout').value})-1;draw();changed();});
$('preview').onclick=action(()=>preview());
$('save').onclick=action(async()=>{
  const key=name,snapshot=JSON.stringify(deck);
  await request(url('deck'),deck);
  const saved=working.get(key);
  if(saved && JSON.stringify(saved.deck)===snapshot)saved.dirty=false;
  if(key===name && JSON.stringify(deck)===snapshot)$('status').textContent='已保存';
  await library();notice('课件已保存');
});
$('check').onclick=action(async()=>{
  const result=await request(url('check'),deck);
  const output=String(result.output||'');
  const first=output.trim().split('\n').map(s=>s.trim()).filter(Boolean)[0]||'自检完成';
  // 只弹一条摘要，不自动展开日志抽屉（展开会盖住页面下方的按钮）
  notice(first);
  $('log').textContent=output;
  $('logs').open=false;
});
$('export').onclick=action(async()=>{
  const key=name,{token}=await request(url('draft'),deck);
  const a=el('a');a.href=url('export',key)+'&draft='+token;a.download=key+'.html';a.click();
});
const structureFields=new Set(['layout','html','htmlFile','css','cssFile','background','veil','build','anim','stagger','speed']);
const saveAsDialog=$('saveAsDialog'), saveAsForm=$('saveAsForm');
$('saveAs').onclick=()=>{
  if(!deck)return;
  saveAsForm.reset();
  saveAsForm.elements.title.value=(deck.meta?.title ?? '')+'（副本）';
  saveAsDialog.showModal();
  saveAsForm.elements.title.select();
};
$('cancelSaveAs').onclick=()=>saveAsDialog.close();
saveAsForm.onsubmit=action(async e=>{
  e.preventDefault();
  const title=saveAsForm.elements.title.value.trim();
  if(!title){
    saveAsForm.elements.title.value='';
    saveAsForm.elements.title.reportValidity();
    return;
  }
  const submit=saveAsForm.querySelector('[type=submit]');
  if(submit.disabled)return;
  submit.disabled=true;
  try {
    const copy=structuredClone(deck);
    copy.meta={...copy.meta,title};
    if(saveAsForm.elements.mode.value==='structure'){
      copy.pages=copy.pages.map(page=>Object.fromEntries(
        Object.entries(page).filter(([field])=>structureFields.has(field))
      ));
      // 骨架模式是"换一节课"，教材对齐信息属于内容，跟着旧课走会误导
      if(copy.meta) delete copy.meta.textbook;
    }
    const key='lesson-'+crypto.randomUUID();
    await request(url('deck',key),copy);
    saveAsDialog.close();
    await library();
    await openDeck(key);
    notice('副本已创建');
  } finally {submit.disabled=false;}
});

const dialog=document.querySelector('dialog');
let lessonTypes=[], lessonId='new', lessonRequest=0;
const elasticNames={
  'elastic-cover':'弹性封面','elastic-objectives':'学习目标（弹性）','elastic-context':'情境导入（弹性）',
  'elastic-concept':'概念要点（弹性）','elastic-formula':'核心公式（弹性）','elastic-derive':'多步推导（弹性）',
  'elastic-example':'例题精讲（弹性）','elastic-practice':'随堂练习（弹性）','elastic-compare':'对比辨析（弹性）',
  'elastic-summary':'课堂小结（弹性）','elastic-homework':'课后作业（弹性）'
};
function layoutName(id, template) {
  return template?.layouts.find(l=>l.id===id)?.name || elasticNames[id] || id;
}
function lessonPreview() {
  const type=lessonTypes.find(t=>t.id===lessonId);
  const template=packs.find(p=>p.id===$('pack').value);
  const names=type.pages.slice(0,6).map(id=>layoutName(id,template));
  $('lessonPreview').textContent='将创建 '+type.pages.length+' 页：'+names.join(' · ')+(type.pages.length>6?' · …':'');
}
async function loadLessons() {
  const version=++lessonRequest;
  lessonTypes=[];
  $('lessonTypes').replaceChildren(el('legend','课型'));
  $('createLesson').disabled=true;
  $('lessonPreview').textContent='正在读取课型…';
  try {
    const types=await request('/api/lesson-types?pack='+encodeURIComponent($('pack').value));
    if(version!==lessonRequest)return;
    lessonTypes=types;
    $('lessonTypes').replaceChildren(el('legend','课型'),...types.map(type=>{
      const label=el('label'), input=el('input');
      input.type='radio';input.name='lessonType';input.value=type.id;
      input.checked=type.id===lessonId;
      input.onchange=()=>{lessonId=type.id;lessonPreview();};
      label.append(input,el('strong',type.name),el('small',type.when));
      return label;
    }));
    lessonPreview();$('createLesson').disabled=false;
  } catch(error) {
    if(version===lessonRequest){
      const retry=el('button','重试');
      retry.type='button';retry.className='btn';retry.style.marginLeft='8px';
      retry.onclick=()=>loadLessons();
      $('lessonPreview').replaceChildren(document.createTextNode('读取课型失败：'+error.message),retry);
    }
  }
}
function openCreate() {
  dialog.showModal();$('title').focus();loadLessons();
}
$('pack').onchange=loadLessons;
$('new').onclick=openCreate;
$('cancel').onclick=()=>dialog.close();
$('import').onclick=()=>$('file').click();
$('file').onchange=()=>action(async()=>{
  const file=$('file').files[0];
  $('file').value='';
  if(!file)return;
  if (/\.pptx$/i.test(file.name)) return importReference(file);
  const html=await file.text();
  notice('正在导入模板…');
  const info=await request('/api/import',{
    filename:file.name,
    html,
    name:file.name.replace(/\.html?$/i,''),
  });
  packs=await request('/api/packs');
  $('pack').replaceChildren(...packs.map(p=>new Option(p.name,p.id)));
  $('pack').value=info.packId;
  const warn=info.warnings?.length?' · '+info.warnings[0]:'';
  notice(`已导入「${info.name}」· ${info.pages} 页${warn}`);
  openCreate();
})();
$('create').onsubmit=e=>{
  e.preventDefault();
  action(async()=>{
    const title=$('title').value.trim();
    if(!title)throw Error('请填写课件标题');
    const pack=packs.find(p=>p.id===$('pack').value), key='lesson-'+crypto.randomUUID();
    const type=lessonTypes.find(t=>t.id===lessonId);
    if(!type || $('createLesson').disabled)return;
    $('createLesson').disabled=true;
    try {
      await request(url('deck',key),{pack:pack.id,meta:{title},pages:type.pages.map(layout=>({layout}))});
    } finally {$('createLesson').disabled=false;}
    dialog.close();$('title').value='';await library();await openDeck(key);
    const math=packs.find(p=>p.id==='math-junior');
    notice(type.skipped?.length ? type.skipped.map(id=>layoutName(id,math || pack)).join('、')+' 页型该模板没有，已跳过' : '课件已创建');
  })();
};
window.addEventListener('beforeunload',e=>{if([...working.values()].some(d=>d.dirty)){e.preventDefault();e.returnValue='';}});
action(async()=>{
  for (const [key,select] of Object.entries(deckSettings)) {
    for (const item of await request('/api/'+key+'s')) {
      select.add(new Option(item.name,item.id));
      if (key==='theme' && $('pageTheme')) $('pageTheme').add(new Option(item.name,item.id));
    }
  }
  packs=await request('/api/packs');
  $('pack').replaceChildren(...packs.map(p=>new Option(p.name,p.id)));
  if(packs.some(p=>p.id==='math-junior'))$('pack').value='math-junior';
  $('new').disabled=false;
  const list=await library();if(list.length)await openDeck(list.find(d=>d.name==='gougu')?.name||list[0].name);
})();
let config;
function formatBytes(n){
  const v=Number(n)||0;
  if(v>=1024*1024)return (v/1024/1024).toFixed(1)+' MB';
  if(v>=1024)return Math.round(v/1024)+' KB';
  return v+' B';
}
async function refreshCacheSummary(){
  const box=$('cacheSummary');
  if(!box)return;
  try{
    const s=await request('/api/cache');
    box.textContent=`PhET 离线实验缓存：${s.phet.count} 个（${formatBytes(s.phet.bytes)}） · 预览草稿 ${s.drafts.count} 份 + 旧备份 ${s.prev.count} 份（${formatBytes(s.drafts.bytes+s.prev.bytes)}） · 素材库 ${s.assets.count} 张（${formatBytes(s.assets.bytes)}）`;
  }catch{
    box.textContent='无法读取缓存占用';
  }
}
async function showSettings(message) {
  config=await request('/api/settings');
  $('configured').textContent=message || (config.configured?'已配置':'未配置');
  $('apiKey').value='';
  $('apiKey').placeholder=config.configured?'留空保留当前密钥':'粘贴 API key';
  $('model').value=config.model;
  $('baseUrl').value=config.baseUrl;
  if ($('mineruConfigured')) $('mineruConfigured').textContent=config.mineruConfigured?'已配置 MinerU Token（教材库可直接上传 PDF）':'未配置（不填也可在教材库导入 MinerU 网页版 .zip）';
  if ($('mineruToken')) { $('mineruToken').value=''; $('mineruToken').placeholder=config.mineruConfigured?'留空保留当前 Token':'粘贴 MinerU API Token'; }
  refreshCacheSummary();
  $('preferences').showModal();
}
$('clearDraftCache')?.addEventListener('click',action(async()=>{
  const out=await request('/api/cache/clear',{target:'drafts'});
  await refreshCacheSummary();
  const failHint=out.failed?.prev?`（${out.failed.prev} 份旧备份被占用未删除）`:'';
  notice(`已清理 ${out.removed.drafts} 份预览草稿和 ${out.removed.prev} 份旧备份${failHint}`);
}));
$('clearPhetCache')?.addEventListener('click',action(async()=>{
  if(!confirm('清理后，PhET 实验下次插入时会重新联网拉取（已导出课件和本地导入的 .html 不受影响）。确认清理？'))return;
  const out=await request('/api/cache/clear',{target:'phet'});
  await refreshCacheSummary();
  const failHint=out.failed?.phet?`（${out.failed.phet} 个文件被占用未删除）`:'';
  notice(`已清理 ${out.removed.phet} 个 PhET 离线缓存${failHint}`);
}));
$('settings').onclick=action(()=>showSettings());
$('closeSettings').onclick=()=>$('preferences').close();
$('settingsForm').onsubmit=e=>{
  e.preventDefault();
  action(async()=>{
    const body={apiKey:$('apiKey').value.trim()||undefined,model:$('model').value,baseUrl:$('baseUrl').value};
    if ($('mineruToken') && $('mineruToken').value.trim()) body.mineruToken=$('mineruToken').value.trim();
    config=await request('/api/settings',body);
    $('apiKey').value='';
    if ($('mineruToken')) $('mineruToken').value='';
    $('preferences').close();
    notice('设置已保存');
  })();
};
function install(snapshot,dirty) {
  deck=snapshot;
  editSeq++; previewedSeq=-1; loadedRevision=0; gotoTarget=-1;
  working.set(name,{deck,pack,dirty});syncDirtyMark();
  $('status').textContent=dirty?'有未保存的修改':'已保存';
  draw();
}
let busy=false;
async function editPage(kind,arg) {
  if(busy||!deck)return;
  busy=true;
  const main=document.querySelector('main'), nav=document.querySelector('nav');
  main.inert=nav.inert=true;
  const before=structuredClone(deck), dirty=!!working.get(name)?.dirty;
  const candidate=structuredClone(deck),page=candidate.pages[index], fields=fieldsOf(page,pack);
  let applied=false;
  try {
    if(kind==='ai') {
      notice('正在改…');
      const assets=aiAssets.length?aiAssets.map(a=>({path:a.path,width:a.width,height:a.height,type:a.type})):undefined;
      const questions=aiQuestions.length?aiQuestions.map(q=>({type:q.type,stem:q.stem,answer:q.answer})):undefined;
      const {ops}=await request('/api/ai',{name,pageIndex:index,instruction:arg,deck,...(assets?{assets}:{}),...(questions?{questions}:{})});
      // 允许的路径：现有文字/图片字段 + background / veil / anim（后三者要校验值）
      const ANIM_OK=['fade','blur','fade-up','fade-down','slide-left','slide-right','scale','zoom','rotate','flip','bounce','none'];
      const assetPaths=new Set(aiAssets.map(a=>a.path));
      for(const op of ops||[]){
        if(!op||op.op!=='set')continue;
        if(op.path==='background'){
          if(op.value==='') { delete page.background; continue; }
          if(typeof op.value==='string'&&assetPaths.has(op.value)) page.background=op.value;
          continue;
        }
        if(op.path==='veil'){
          const v=Number(op.value);
          if(Number.isFinite(v)&&v>=0&&v<=1) page.veil=v;
          continue;
        }
        if(op.path==='notes'){
          if(typeof op.value==='string'&&op.value.trim())page.notes=op.value.trim().slice(0,600);
          continue;
        }
        if(op.path==='anim'){
          if(ANIM_OK.includes(op.value)) { if(op.value==='none') delete page.anim; else page.anim=op.value; }
          continue;
        }
        const f=fields.get(op.path);
        if(f) {
          f.obj[f.key]=op.value;
        } else if (typeof op.path==='string') {
          const specSlots = layout(page)?.slots || [];
          const arrMatch = /^([\w.]+)\[(\d+)\]\.([\w]+)$/.exec(op.path);
          if (arrMatch && specSlots.includes(arrMatch[1] + '[].' + arrMatch[3])) {
            const [, base, idxStr, child] = arrMatch;
            const parts = base.split('.');
            const arrKey = parts.pop();
            let holder = page;
            for (const part of parts) holder = holder[part] ??= {};
            const arr = (holder[arrKey] ??= []);
            const idx = Number(idxStr);
            if (Array.isArray(arr) && idx >= 0 && idx <= arr.length) {
              arr[idx] = { ...(arr[idx] || {}), [child]: op.value };
            }
          } else if (Array.isArray(op.value) && specSlots.some(s => s.startsWith(op.path + '[].'))) {
            const parts = op.path.split('.');
            const arrKey = parts.pop();
            let holder = page;
            for (const part of parts) holder = holder[part] ??= {};
            holder[arrKey] = op.value;
          } else if (specSlots.includes(op.path) && !op.path.includes('[')) {
            const parts = op.path.split('.');
            const leaf = parts.pop();
            let holder = page;
            for (const part of parts) holder = holder[part] ??= {};
            holder[leaf] = op.value;
          }
        }
      }
    } else if(kind==='scale'){
      const css=page.css||'',rule=':scope { --page-scale: '+arg+'; }';
      page.css=scaleRule.test(css)?css.replace(scaleRule,rule):(css+'\n'+rule).trim();
    } else {
      for(const f of fields.values()){
        f.obj[f.key]=kind==='short'?shorten(f.value,f.limit,f.field):f.field==='formula'?f.value:splitLines(f.value);
      }
    }
    const paths=[...fields].filter(([,f])=>f.value!==f.obj[f.key]).map(([path])=>path);
    for (const slot of (layout(page)?.slots || [])) {
      const base = slot.split('[].')[0];
      const prevVal = base.split('.').reduce((o, k) => o?.[k], before.pages[index]);
      const nextVal = base.split('.').reduce((o, k) => o?.[k], page);
      if (JSON.stringify(prevVal) !== JSON.stringify(nextVal) && !paths.includes(base)) {
        paths.push(base);
      }
    }
    if(before.pages[index].css!==page.css)paths.push('css');
    if(before.pages[index].background!==page.background)paths.push('background');
    if(before.pages[index].veil!==page.veil)paths.push('veil');
    if(before.pages[index].anim!==page.anim)paths.push('anim');
    if(before.pages[index].notes!==page.notes)paths.push('notes');
    if(!paths.length){notice(kind==='short'?'这一页没有超过字数上限的字段，不用截断':kind==='split'?'这一页没有需要分行的长句（<40 字或已有换行）':'当前页无需修改');return;}
    applied=true;
    install(candidate,true);
    await preview();
    const {errors}=await request(url('check')+'&page='+index,deck);
    const hardErrors=(errors||[]).filter(msg=>!/超过\s*\d+\s*字/.test(msg));
    const softOver=(errors||[]).filter(msg=>/超过\s*\d+\s*字/.test(msg));
    if(hardErrors.length)throw Error(hardErrors.join('、').trim());
    const history=histories.get(name)||[];
    history.push({deck:before,index});
    if(history.length>10)history.shift();
    histories.set(name,history);
    $('undo').disabled=false;
    const kindLabel=kind==='short'?'已截断 '+paths.length+' 个字段 · ':kind==='split'?'已给 '+paths.length+' 个字段分行 · ':'';
    const overHint=softOver.length?(' · ⚠ '+softOver[0]+'（已标红，可手动精简或点「压到字数内」）'):'';
    notice(kindLabel+'第 '+(index+1)+' 页 '+paths[0]+' 已改 · 已应用 · '+paths.length+' 处修改 · 可撤销'+overHint);
  } catch(e) {
    if(applied){install(before,dirty);await preview();notice('已自动撤销 · '+e.message);}
    else if(e.message==='先配置 API key'){notice(e.message);await showSettings(e.message);}
    else throw e;
  } finally {main.inert=nav.inert=busy=false;}
}
/* PPT 模板、素材和原稿预览共用一个参照编号。 */
let currentReference='';
let pendingPptxFile=null;
function askPptxImportOptions(file){
  return new Promise((resolve)=>{
    const dlg=$('pptxImportDialog');
    if(!dlg)return resolve({name:file.name.replace(/\.pptx$/i,''),extractAssets:true});
    pendingPptxFile=file;
    $('pptxImportFileNote').textContent=`文件：${file.name}（${formatBytes(file.size)}）`;
    $('pptxImportName').value=file.name.replace(/\.pptx$/i,'');
    try{
      const saved=localStorage.getItem('ck_pptx_extract_assets');
      $('pptxExtractAssets').checked=saved===null?true:saved==='1';
    }catch{ $('pptxExtractAssets').checked=true; }
    let settled=false;
    const finish=(val)=>{
      if(settled)return;
      settled=true;
      pendingPptxFile=null;
      dlg.removeEventListener('close',onClose);
      resolve(val);
    };
    const onClose=()=>finish(null);
    dlg.addEventListener('close',onClose);
    $('pptxImportCancel').onclick=()=>{ dlg.close(); finish(null); };
    $('pptxImportForm').onsubmit=(e)=>{
      e.preventDefault();
      const tplName=$('pptxImportName').value.trim()||file.name.replace(/\.pptx$/i,'');
      const extractAssets=$('pptxExtractAssets').checked;
      try{ localStorage.setItem('ck_pptx_extract_assets',extractAssets?'1':'0'); }catch{}
      dlg.close();
      finish({name:tplName,extractAssets});
    };
    dlg.showModal();
    $('pptxImportName').focus();
  });
}
async function importReference(file){
  if(file.size>30*1024*1024)throw Error('文件不能超过 30 MB');
  const opts=await askPptxImportOptions(file);
  if(!opts)return;
  const btn=$('import');btn.disabled=true;btn.textContent='正在分析…';
  try{
    const data=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
    const info=await request('/api/reference',{filename:file.name,base64:data.split(',')[1],name:opts.name,extractAssets:opts.extractAssets});
    currentReference=info.slug;
    packs=await request('/api/packs');
    $('pack').replaceChildren(...packs.map(p=>new Option(p.name,p.id)));
    $('pack').value=info.packId;
    $('importPreview').href='/api/reference-preview?slug='+encodeURIComponent(info.slug);
    $('refSummary').textContent='「'+info.name+'」· '+info.structure.length+' 页结构 · '+info.palette.length+' 主色'+(info.assetsExtracted===false?' · 未抽图进素材库':'');
    $('refPalette').replaceChildren(...info.palette.slice(0,8).map(c=>{const s=el('span');s.className='swatch';s.style.background=c;s.title=c;return s;}));
    $('refBg').textContent='背景：'+({photo:'整页照片',solid:'纯色',gradient:'渐变',white:'白色'}[info.background?.kind]||info.background?.kind||'无');
    $('refStructure').textContent=info.summary.map(s=>'第 '+s.page+' 页：'+s.layout).join('\n');
    $('refDialog').showModal();
  } finally {btn.disabled=false;btn.textContent='＋ 导入模板 / 参照';}
}
$('refClose').onclick=()=>$('refDialog').close();
$('refOk').onclick=()=>{$('refDialog').close();$('generate').click();};
/* 素材库：导入参照时抽出的图片，可复用；也支持"给 AI 引用"的多选模式 */
let pickedAsset='', pickedRef='';
let aiAssets=[];        // 供页内 AI 引用的素材（可多张）
let assetPickMode='';   // '' = 普通插入；'ai' = 给 AI 引用
let genAssets=[], hwAssets=[];
$('assetReplace').onclick=action(()=>{
  if (!pickedAsset) throw Error('先选一张素材');
  if (!validReplacementTarget(selectedBlock)||selectedBlock.index!==index) throw Error('请先在微调模式中选中一个块');
  const src='../assets/'+pickedRef+'/'+pickedAsset.file;
  if (!replacementAssetPath(src)) throw Error('素材路径无效');
  if (![pickedAsset.width,pickedAsset.height].every(Number.isFinite)||pickedAsset.width<=0||pickedAsset.height<=0) throw Error('素材尺寸无效');
  if (pendingReplacement) return;
  const frameWindow=$('frame').contentWindow;
  if (!frameWindow) throw Error('预览尚未就绪');
  const requestId=crypto.randomUUID();
  pendingReplacement={requestId,index,page:deck.pages[index],target:{...selectedBlock,path:[...selectedBlock.path]},src,width:pickedAsset.width,height:pickedAsset.height};
  syncAssetReplaceButton();
  frameWindow.postMessage({ck:'replaceBlock',editorPreview:String(revision),requestId,index,src},'*');
});
$('assetsDialog').addEventListener('close',()=>{
  if (!pendingReplacement) return;
  pendingReplacement=null;
  syncAssetReplaceButton();
});
let assetBatchMode=false;
let assetBatchSelected=new Set();
let assetCurrentList=[];
function syncAssetDeleteUi(){
  const normal=!assetBatchMode && assetPickMode!=='ai' && assetPickMode!=='gen' && assetPickMode!=='hw' && assetPickMode!=='replaceFree';
  const delOne=$('assetDeleteOne');
  if(delOne) delOne.hidden=!(normal && pickedAsset);
  const bar=$('assetBatchBar');
  if(bar) bar.hidden=!assetBatchMode;
  const toggle=$('assetBatchToggle');
  if(toggle){
    toggle.hidden=(assetPickMode==='ai'||assetPickMode==='gen'||assetPickMode==='hw'||assetPickMode==='replaceFree'||!assetCurrentList.length);
    toggle.textContent=assetBatchMode?'退出批量删除':'批量删除';
  }
  const delBatch=$('assetDeleteBatch');
  if(delBatch){
    delBatch.textContent=`删除所选（${assetBatchSelected.size}）`;
    delBatch.disabled=assetBatchSelected.size===0;
  }
  const selAll=$('assetSelectAll');
  if(selAll){
    selAll.textContent=(assetCurrentList.length && assetBatchSelected.size===assetCurrentList.length)?'取消全选':'全选';
  }
}
async function openAssets(mode='', forcedRef=''){
  assetPickMode=mode;
  assetBatchMode=false;
  assetBatchSelected=new Set();
  const [groups, refs]=await Promise.all([
    request('/api/asset-groups').catch(()=>[]),
    request('/api/references').catch(()=>[]),
  ]);
  const free=$('blockMode').checked || mode==='free' || mode==='replaceFree';
  if(!free && mode!=='ai' && !groups.length && !refs.length){notice('素材库目前为空：导入 PPT（勾选抽图）或 MinerU 教材后，图片会自动出现在这里');return;}
  const ref=forcedRef
    || (groups.some(g=>g.ref===currentReference)?currentReference:'')
    || groups[0]?.ref
    || refs.find(r=>r.preview)?.slug
    || refs[0]?.slug
    || '';
  const groupSel=$('assetGroupSelect');
  if(groupSel){
    const opts=groups.length
      ? groups.map(g=>new Option(`${g.name}（${g.count} 张 · ${formatBytes(g.bytes)}）`,g.ref))
      : (ref?[new Option(refs.find(r=>r.slug===ref)?.name||ref,ref)]:[new Option('暂无素材组','')]);
    groupSel.replaceChildren(...opts);
    if(ref)groupSel.value=ref;
    groupSel.onchange=()=>openAssets(mode,groupSel.value);
  }
  const groupObj=groups.find(g=>g.ref===ref);
  const name=groupObj?.name||refs.find(r=>r.slug===ref)?.name||ref;
  pickedRef=ref;
  const list=ref ? await request('/api/assets?ref='+encodeURIComponent(ref)).catch(()=>[]) : [];
  assetCurrentList=list;
  $('assetsPreview').hidden=!(groupObj?.preview || refs.find(r=>r.slug===ref)?.preview);
  $('assetsPreview').href='/api/reference-preview?slug='+encodeURIComponent(ref);
  pickedAsset='';
  syncAssetReplaceButton();
  const aiMode=mode==='ai';
  const genMode=mode==='gen'||mode==='hw';
  const bucket=genMode?(mode==='gen'?genAssets:hwAssets):aiAssets;
  const chosen=new Set((aiMode||genMode)?bucket.map(a=>a.file):[]);
  $('assetsRef').textContent=ref?`当前素材组：${name} · ${list.length} 张素材`:'暂无素材';
  $('assetHint').textContent=(aiMode||genMode)?'点图多选，选完点下面的确认按钮':'选中一张可插入、用作背景或删除；点右上角「批量删除」可多选清理';
  const grid=$('assetGrid');
  grid.replaceChildren(...list.map((item)=>{
    const btn=el('button');btn.type='button';btn.dataset.file=item.file;
    const img=el('img');img.src=item.url;img.alt=item.file;img.loading='lazy';
    const cap=el('small',`${item.width}×${item.height} · 第${item.page||'?'}页`);
    btn.append(img,cap);
    if((aiMode||genMode) && chosen.has(item.file)) btn.classList.add('picked');
    btn.onclick=()=>{
      if(assetBatchMode){
        if(assetBatchSelected.has(item.file)) assetBatchSelected.delete(item.file);
        else assetBatchSelected.add(item.file);
        btn.classList.toggle('batch-del',assetBatchSelected.has(item.file));
        syncAssetDeleteUi();
        return;
      }
      if(mode==='replaceFree'){
        const b=freeBlock();
        if(b) { remember('换图'); b.src=pickedRef+'/'+item.file; changed(0); notice('已换图 · 可撤销'); }
        $('assetsDialog').close();
        return;
      }
      if(aiMode||genMode){
        if(chosen.has(item.file)) chosen.delete(item.file);
        else chosen.add(item.file);
        btn.classList.toggle('picked',chosen.has(item.file));
        const picked=list.filter(x=>chosen.has(x.file));
        const mapped=picked.map(x=>({file:x.file,path:'../assets/'+ref+'/'+x.file,width:x.width,height:x.height,type:x.type}));
        if(genMode){ if(mode==='gen')genAssets=mapped; else hwAssets=mapped; }
        else aiAssets=mapped;
        $('assetHint').textContent='已选 '+picked.length+' 张'+(picked.length?'：'+picked.map(x=>x.file).join('、'):'');
        $('aiPickDone').textContent=genMode?'用这些配图（'+picked.length+'）':'用这些作 AI 素材（'+picked.length+'）';
        return;
      }
      for(const b of grid.children)b.classList.remove('picked');
      btn.classList.add('picked');
      pickedAsset=item;
      $('assetHint').textContent=`已选 ${item.file}（${item.type==='photo'?'照片':'图标'}）`;
      syncAssetReplaceButton();
      syncAssetDeleteUi();
    };
    return btn;
  }));
  const freeMode=free&&!aiMode&&!genMode;
  $('assetVeilRow').hidden=!freeMode;
  $('assetVeil').onpointerdown=()=>remember('调整压暗');
  $('assetVeil').onkeydown=()=>remember('调整压暗');
  $('assetVeil').oninput=()=>{
    $('assetVeilVal').textContent=Number($('assetVeil').value).toFixed(2);
    const page=deck.pages[index];
    if(page){ page.veil=Number($('assetVeil').value); liveStyle({veil:page.veil}); markDirty(); }
  };
  $('assetBg').hidden=$('assetInsert').hidden=aiMode||genMode;
  $('assetFree').hidden=$('uploadFree').hidden=aiMode||genMode||!free;
  $('aiPickDone').hidden=!(aiMode||genMode);
  $('aiPickDone').textContent=(genMode?'用这些配图（':'用这些作 AI 素材（')+((aiMode||genMode)?bucket.length:0)+'）';
  if (free && !aiMode) $('assetHint').textContent='选素材后点「插入可拖动图片」，或上传本地图片';
  syncAssetReplaceButton();
  syncAssetDeleteUi();
  if(!$('assetsDialog').open) $('assetsDialog').showModal();
}
$('assetBatchToggle')?.addEventListener('click',()=>{
  assetBatchMode=!assetBatchMode;
  assetBatchSelected.clear();
  pickedAsset='';
  for(const b of $('assetGrid').children) b.classList.remove('picked','batch-del');
  $('assetHint').textContent=assetBatchMode?'批量删除模式：点击要删除的图片，完成后点「删除所选」':'选中一张可插入、用作背景或删除';
  syncAssetReplaceButton();
  syncAssetDeleteUi();
});
$('assetSelectAll')?.addEventListener('click',()=>{
  const allSelected=assetCurrentList.length && assetBatchSelected.size===assetCurrentList.length;
  assetBatchSelected=allSelected?new Set():new Set(assetCurrentList.map(x=>x.file));
  for(const b of $('assetGrid').children) b.classList.toggle('batch-del',assetBatchSelected.has(b.dataset.file));
  syncAssetDeleteUi();
});
$('assetDeleteOne')?.addEventListener('click',action(async()=>{
  if(!pickedAsset||!pickedRef)return;
  if(!confirm(`确认删除素材「${pickedAsset.file}」？（已导出的离线 HTML 不受影响）`))return;
  const res=await request('/api/assets/delete',{ref:pickedRef,files:[pickedAsset.file]});
  notice(`已删除素材 ${pickedAsset.file}`);
  await openAssets(assetPickMode,res.remaining>0?pickedRef:'');
}));
$('assetDeleteBatch')?.addEventListener('click',action(async()=>{
  const files=[...assetBatchSelected];
  if(!files.length||!pickedRef)return;
  if(!confirm(`确认批量删除这 ${files.length} 张素材？（已导出的离线 HTML 不受影响）`))return;
  const res=await request('/api/assets/delete',{ref:pickedRef,files});
  const failMsg=res.failed?.length?`（${res.failed.length} 张被占用未删除：${res.failed.join('、')}）`:'';
  notice(`已删除 ${res.deleted} 张素材${failMsg}`);
  await openAssets(assetPickMode,res.remaining>0?pickedRef:'');
}));
$('assets').onclick=action(async()=>{ await openAssets(''); });
$('aiAssetsPick')?.addEventListener('click',action(async()=>{ await openAssets('ai'); }));
$('aiPickDone').onclick=()=>{
  $('assetsDialog').close();
  if(assetPickMode==='gen'||assetPickMode==='hw'){
    const list=assetPickMode==='gen'?genAssets:hwAssets;
    const note=assetPickMode==='gen'?$('genAssetsNote'):$('hwAssetsNote');
    const btn=assetPickMode==='gen'?$('genPickAssets'):$('hwPickAssets');
    note.textContent=list.length?'已选 '+list.length+' 张配图':'未选配图';
    btn.classList.toggle('primary',!!list.length);
    notice(list.length?'生成时会从这 '+list.length+' 张里配图':'已取消配图');
    return;
  }
  const n=aiAssets.length;
  if($('aiAssetsNote'))$('aiAssetsNote').textContent=n?'已选 '+n+' 张素材':'未选素材';
  $('aiAssetsPick')?.classList.toggle('primary',!!n);
  notice(n?'已引用 '+n+' 张素材，AI 改写时会参考它们':'已取消引用素材');
};
$('assetFree').onclick=action(()=>{
  if (!pickedAsset) throw Error('先选一张素材');
  $('assetsDialog').close();
  return addFree('image',pickedRef+'/'+pickedAsset.file);
});
$('uploadFree').onclick=()=>$('freeFile').click();
$('freeFile').onchange=action(async()=>{
  const file=$('freeFile').files[0],page=deck.pages[index];
  $('freeFile').value='';
  if (!file) return;
  const base64=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(file);
  });
  const result=await request('/api/upload',{filename:file.name,base64});
  if (page!==deck.pages[index] || !$('assetsDialog').open) return;
  $('assetsDialog').close();await addFree('image',result.path);
});
$('assetClose').onclick=()=>$('assetsDialog').close();
$('assetBg').onclick=action(()=>{
  if(!pickedAsset)throw Error('先选一张素材');
  const ref=pickedRef;
  const p=deck.pages[index];
  const file='../assets/'+ref+'/'+pickedAsset.file;
  remember('用作本页背景');
  p.background=file;p.veil=0.6;
  $('assetsDialog').close();fields();changed();
  notice('已用作本页背景');
});
$('assetInsert').onclick=action(()=>{
  if(!pickedAsset)throw Error('先选一张素材');
  const spec=layout(deck.pages[index]);
  const slot=(spec.slots||[]).find(s=>/^(image|figure|img)$/.test(s)||/\.(image|figure|img)$/.test(s));
  if(!slot)throw Error('这一页没有图片位，试试「用作本页背景」');
  const ref=pickedRef;
  const key=slot.split('.').pop();
  remember('插入图片位');
  deck.pages[index][key]='../assets/'+ref+'/'+pickedAsset.file;
  $('assetsDialog').close();fields();changed();
  notice('已插入到图片位');
});
/* 一句话生成 / 课后作业 */
async function loadGenTypes(){
  const types=await request('/api/lesson-types');
  $('genType').replaceChildren(...types.map(t=>new Option(t.name,t.id)));
  const refs=await request('/api/references').catch(()=>[]);
  $('genRef').replaceChildren(new Option('不用参照',''),...refs.map(r=>new Option(r.name,r.slug)));
  if(currentReference)$('genRef').value=currentReference;
}
const paperLabel=p=>[p.title,[p.subject,p.grade,p.term].filter(Boolean).join('/')].filter(Boolean).join(' · ');
async function showPaperList(){
  const papers=await request('/api/papers');
  $('paperList').replaceChildren(...papers.map(p=>{
    const types=Object.entries(p.questions.byType).map(([type,n])=>type+' '+n).join('·');
    const row=el('p',paperLabel(p)+' · '+p.questions.total+' 题'+(types?'（'+types+'）':'')+' · 约 '+(p.chars/1000).toLocaleString('zh-CN')+' 千字 ');
    row.append(button('删除',async()=>{
      if(!confirm('删除「'+p.title+'」？'))return;
      const res=await fetch('/api/paper?id='+encodeURIComponent(p.id),{method:'DELETE'});
      if(!res.ok)throw Error((await res.json()).error);
      await showPaperList();
    }));
    return row;
  }));
}
$('papers').onclick=action(async()=>{await showPaperList();$('paperDialog').showModal();});
$('paperClose').onclick=()=>$('paperDialog').close();
$('paperForm').onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  if(form.inert)return;
  form.inert=true;
  try{
    const data=Object.fromEntries(new FormData(form));
    const file=$('paperFile').files[0];
    if(file && data.text.trim())throw Error('请选择文件或粘贴正文其中一种');
    if(file){data.text=await readMaterialFile(file);data.title ||= file.name;}
    const p=await request('/api/paper',data);
    form.reset();
    $('paperStatus').textContent='已保存「'+p.title+'」，识别到 '+p.questions.total+' 题';
    await showPaperList();
  }catch(error){$('paperStatus').textContent=error.message;}
  finally{form.inert=false;}
};
function pickedPapers(prefix){
  return Array.from($(prefix+'Papers').querySelectorAll('input:checked'),box=>({id:box.value}));
}
async function loadPaperSelector(prefix){
  const papers=await request('/api/papers');
  const group=$(prefix+'Papers'),note=$(prefix+'PaperNote');
  group.replaceChildren(...papers.map(p=>{
    const label=el('label'),box=el('input');
    box.type='checkbox';box.value=p.id;
    label.append(box,paperLabel(p));
    return label;
  }));
  group.onchange=()=>{
    const ids=new Set(pickedPapers(prefix).map(p=>p.id));
    for(const box of group.querySelectorAll('input'))box.disabled=!box.checked && ids.size>=3;
    note.textContent=ids.size?'将参考：'+papers.filter(p=>ids.has(p.id)).map(p=>p.title).join('、'):(papers.length?'':'库中暂无试卷');
  };
  group.onchange();
}
const bookLabel=b=>[b.title,[b.publisher,b.edition].filter(Boolean).join('/'),b.grade,b.volume].filter(Boolean).join(' · ');
const tenThousands=n=>(n/10000).toLocaleString('zh-CN',{maximumFractionDigits:n<100?4:2});
const wordCount=n=>n<10000?n.toLocaleString('zh-CN')+' 字':(n/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 万字';
async function showBookList(){
  const books=await request('/api/books');
  $('bookList').replaceChildren(...books.map(b=>{
    const item=el('details');
    const summaryMeta=[b.chapters.length+' 章','约 '+wordCount(b.chars),b.pageCount?b.pageCount+' 页':'',b.bodyStartPage>1?'正文起自 PDF 第 '+b.bodyStartPage+' 页':''].filter(Boolean).join(' · ');
    item.append(el('summary',bookLabel(b)+' · '+summaryMeta));
    for(const c of b.chapters)item.append(el('p','第 '+c.no+' 章 · '+c.title+' · '+c.chars+' 字'));
    if (b.pageCount) {
      item.append(button('校对页码',async()=>{
        const cur=b.bodyStartPage||1;
        const ans=prompt('请输入「纸质课本正文第 1 页」在 PDF 中是第几页（正整数，当前为第 '+cur+' 页）：',String(cur));
        if(ans===null)return;
        const n=Number(ans.trim());
        if(!Number.isInteger(n)||n<1||n>500)throw Error('请输入 1~500 的正整数');
        await request('/api/book/page-offset',{id:b.id,bodyStartPage:n});
        $('bookStatus').textContent='已重新校对页码：PDF 第 '+n+' 页 = 课本第 1 页（无需重传 PDF）';
        await showBookList();
      }));
    }
    item.append(button('删除教材',async()=>{
      if(!confirm('删除「'+bookLabel(b)+'」？'))return;
      const res=await fetch('/api/book?id='+encodeURIComponent(b.id),{method:'DELETE'});
      if(!res.ok)throw Error((await res.json()).error);
      await showBookList();
    }));
    return item;
  }));
}
$('books').onclick=action(async()=>{
  await showBookList();
  $('bookDialog').showModal();
});
$('bookClose').onclick=()=>$('bookDialog').close();
$('bookForm').onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  if(form.inert)return;
  const data=Object.fromEntries(new FormData(form));
  const file=$('bookFile').files[0];
  form.inert=true;
  try{
    if(file && data.text.trim())throw Error('请选择文件或粘贴正文其中一种');
    if(file){
      data.source=file.name;
      if(/\.(pdf|zip)$/i.test(file.name)){
        const isPdf=/\.pdf$/i.test(file.name);
        if(file.size>45*1024*1024)throw Error((isPdf?'PDF':'ZIP')+' 文件超过 45 MB，建议先按章节拆分');
        $('bookStatus').textContent=isPdf?'正在上传并调用 MinerU 云端解析 PDF（保留公式、页码与插图，通常需 15~60 秒）…':'正在解包 MinerU 教材结果包…';
        const bytes=new Uint8Array(await file.arrayBuffer());
        let binary='';
        for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
        const b=await request('/api/book/mineru',{
          title:data.title,publisher:data.publisher,edition:data.edition,grade:data.grade,volume:data.volume,
          bodyStartPage:data.bodyStartPage?Number(data.bodyStartPage):1,
          filename:file.name,kind:isPdf?'pdf':'zip',dataBase64:btoa(binary),
        });
        form.reset();
        const extra=[b.pageCount?b.pageCount+' 页':'',b.imageCount?'提取 '+b.imageCount+' 张插图':''].filter(Boolean).join(' · ');
        $('bookStatus').textContent='解析完成：识别到 '+b.chapters.length+' 章（约 '+wordCount(b.chars)+(extra?' · '+extra:'')+'）';
        await showBookList();
        return;
      }else if(/\.docx$/i.test(file.name)){
        if(file.size>20*1024*1024)throw Error('Word 文件超过 20 MB');
        await import('/mammoth.browser.min.js');
        data.text=(await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;
      }else if(/\.(md|txt)$/i.test(file.name))data.text=await file.text();
      else throw Error('请选择 pdf、zip、docx、md 或 txt 文件');
    }else data.source='粘贴正文';
    const b=await request('/api/book',data);
    form.reset();
    $('bookStatus').textContent='识别到 '+b.chapters.length+' 章，约 '+wordCount(b.chars);
    await showBookList();
  }catch(error){$('bookStatus').textContent=error.message;}
  finally{form.inert=false;}
};
function pickedBook(prefix){
  const bookId=$(prefix+'Book').value;
  if(!bookId) return {};
  const pageRange=$(prefix+'BookPages')?.value.trim() || '';
  if(pageRange) return {book:{id:bookId,pageRange}};
  const chapters=Array.from($(prefix+'Chapters').selectedOptions,o=>Number(o.value));
  return chapters.length ? {book:{id:bookId,chapters}} : {book:{id:bookId,chapters:[],autoLocate:true}};
}
async function referenceAssets(limit=24){
  const refs=await request('/api/references').catch(()=>[]);
  const ref=currentReference||refs[0]?.slug||'';
  if(!ref)return [];
  const list=await request('/api/assets?ref='+encodeURIComponent(ref)).catch(()=>[]);
  return list.slice(0,limit).map(a=>({path:'../assets/'+ref+'/'+a.file,width:a.width,height:a.height,type:a.type}));
}
async function loadBookSelector(prefix){
  const books=await request('/api/books');
  const select=$(prefix+'Book'), chapters=$(prefix+'Chapters'), note=$(prefix+'BookNote'), pagesInput=$(prefix+'BookPages');
  select.replaceChildren(new Option('不用教材',''),...books.map(b=>new Option(bookLabel(b),b.id)));
  const refreshNote=()=>{
    const b=books.find(b=>b.id===select.value);
    if(!b) return;
    const range=pagesInput?.value.trim()||'';
    if(range){ note.textContent='将按原书页码精准截取：P'+range.replace(/^p/i,''); return; }
    const nums=Array.from(chapters.selectedOptions,o=>Number(o.value));
    const chars=b.chapters.reduce((n,c)=>n+(nums.includes(c.no)?c.chars:0),0)||0;
    note.textContent=nums.length
      ? '将注入：第 '+nums.join('、')+' 章（约 '+wordCount(chars)+'）'
      : '未手选章节：将按课题自动匹配教材目录树精准定位';
  };
  if(pagesInput) pagesInput.oninput=refreshNote;
  select.onchange=()=>{
    const b=books.find(b=>b.id===select.value);
    $(prefix+'BookFields').hidden=!b;
    if(pagesInput) pagesInput.value='';
    chapters.replaceChildren(...(b?.chapters||[]).map(c=>new Option('第 '+c.no+' 章 · '+c.title,c.no)));
    chapters.onchange=refreshNote;
    if(!b){
      // 没挂教材时的提醒：内容只能靠通用知识，容易泛（老师 11:30 要求）
      note.textContent='⚠ 当前未挂教材，将用通用知识生成，内容可能偏泛'+(books.length?'':'（先去「教材库」导入教材）');
      $(prefix+'BookFields').hidden=true;
      return;
    }
    refreshNote();
  };
  select.onchange();
}
function usageNote(rows){
  return rows.length ? ' · 参考材料：'+rows.map(m=>m.kind==='book' ? [m.title,m.edition,m.chapters.length?'第 '+m.chapters.join('、')+' 章':'',m.note].filter(Boolean).join(' · ') : (m.from==='library'?'试卷库 · '+m.title:(m.kind==='paper'?'题目参考 · ':'')+m.name)+(m.usedChars===0?'（未纳入）':m.truncated?'（已截断）':'')).join('、') : '';
}
function showMaterials(){
  const rows=deck.materials || [];
  showMaterialCount(rows.length);
  $('materialList').replaceChildren(...rows.map(m=>{
    const row=el('div',m.name+' · '+m.chars+' 字 ');
    row.append(button('删除',()=>materialAction(async()=>{
      await saveMaterials(rows.filter(item=>item.id!==m.id));
      $('materialStatus').textContent='已从当前课件移除「'+m.name+'」';
    })));
    return row;
  }));
  $('materialName').value='材料 '+(rows.length+1);
}
async function saveMaterials(rows){
  const {deck:snapshot}=await request(url('deck'));
  snapshot.materials=rows;
  if (!rows.length) delete snapshot.materials;
  await request(url('deck'),snapshot);
  if (rows.length) deck.materials=rows;
  else delete deck.materials;
  showMaterials();
}
async function materialAction(fn){
  const form=$('materialDialog').querySelector('form');
  if(form.inert)return;
  form.inert=true;
  try {await fn();} catch(err){$('materialStatus').textContent=err.message;}
  finally {form.inert=false;}
}
$('materialDialog').oncancel=e=>{if(e.currentTarget.querySelector('form').inert)e.preventDefault();};
$('importMaterials').onclick=()=>{
  $('materialFile').value=$('materialText').value=$('materialStatus').textContent='';
  showMaterials();
  $('materialDialog').showModal();
};
async function readMaterialFile(file){
  if(/\.docx$/i.test(file.name)){
    if(file.size>20*1024*1024)throw Error('Word 文件超过 20 MB，请缩小后再试');
    let text;
    try {
      await import('/mammoth.browser.min.js');
      text=(await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;
    } catch {
      throw Error('这个 Word 打不开，可能加了密码，另存为 .txt 再试');
    }
    if(!text.trim())throw Error('没读到文字，可能是扫描件或全是图片');
    return text;
  }
  if(!/\.(md|txt)$/i.test(file.name))throw Error('请另存为 txt/md');
  return file.text();
}
$('materialFile').onchange=()=>materialAction(async()=>{
  const file=$('materialFile').files[0];
  if(!file)return;
  $('materialText').value='';
  $('materialStatus').textContent='';
  $('materialName').value=file.name.replace(/\.docx$/i,'');
  const text=await readMaterialFile(file);
  $('materialText').value=/\.docx$/i.test(file.name)?text.trim():text;
});
$('materialAdd').onclick=()=>materialAction(async()=>{
  const text=$('materialText').value;
  if(!text.trim())throw Error('材料内容为空');
  const points=Array.from(text);
  const result=await request('/api/material',{name:$('materialName').value.trim()||'材料 '+((deck.materials?.length||0)+1),text:points.slice(0,200000).join('')});
  await saveMaterials([...(deck.materials||[]),result.material]);
  $('materialText').value=$('materialFile').value='';
  $('materialStatus').textContent=points.length>200000 || result.truncated?'已挂材料，正文已截断至 200000 字符':'已挂材料';
});
$('generate').onclick=action(async()=>{
  await loadGenTypes();
  $('genTitle').value='';$('genBrief').value='';$('genStatus').textContent='';
  await Promise.all([loadBookSelector('gen'),loadPaperSelector('gen')]);
  $('genDialog').showModal();$('genTitle').focus();
});
$('genCancel').onclick=()=>$('genDialog').close();
$('genGo').onclick=action(async()=>{
  const title=$('genTitle').value.trim();
  if(!title)throw Error('请填写课题');
  const btn=$('genGo');btn.disabled=true;$('genStatus').textContent='正在提炼本课重难点并饱满生成（两阶段，约 20–60 秒）…';
  try{
    const autoAssets=genAssets;
    const out=await request('/api/generate',{deckName:name,title,grade:$('genGrade').value,lessonType:$('genType').value,density:$('genDensity')?.value||'standard',brief:$('genBrief').value,pack:$('pack').value,mode:'lesson',...pickedBook('gen'),papers:pickedPapers('gen'),reference:$('genRef').value||currentReference||undefined,...(autoAssets.length?{assets:autoAssets}:{}),...(genQuestions.length?{questions:genQuestions.map(q=>({type:q.type,stem:q.stem,answer:q.answer}))}:{})});
    const key='lesson-'+crypto.randomUUID();
    const usage=out.materialUsage || [];
    delete out.materialUsage;
    const materials=usage.filter(m=>m.kind!=='book' && m.from!=='library');
    if (materials.length) out.materials=materials.map(({id,name,chars,kind})=>({id,name,chars,kind}));
    await request(url('deck',key),out);
    $('genDialog').close();
    await library();await openDeck(key);
    notice('已生成「'+title+'」，可以直接改字或调版式'+usageNote(usage));
  } finally {btn.disabled=false;$('genStatus').textContent='';}
});
$('homework').onclick=action(async()=>{
  $('hwTitle').value=(deck.meta?.title?deck.meta.title+' · 课后作业':'');
  $('hwBrief').value='';$('hwStatus').textContent='';
  await Promise.all([loadBookSelector('hw'),loadPaperSelector('hw')]);
  $('hwDialog').showModal();$('hwTitle').focus();
});
$('hwCancel').onclick=()=>$('hwDialog').close();
$('hwGo').onclick=action(async()=>{
  const title=$('hwTitle').value.trim();
  if(!title)throw Error('请填写课题');
  const btn=$('hwGo');btn.disabled=true;$('hwStatus').textContent='正在生成作业…';
  try{
    const autoAssets=hwAssets;
    const out=await request('/api/generate',{deckName:name,title,grade:$('hwGrade').value,questionCount:Number($('hwCount')?.value||5),freedom:$('hwFreedom')?.value||'balanced',difficulty:$('hwDifficulty')?.value||'tiered',brief:$('hwBrief').value,pack:$('pack').value,mode:'homework',...pickedBook('hw'),papers:pickedPapers('hw'),reference:currentReference||undefined,...(autoAssets.length?{assets:autoAssets}:{}),...(hwQuestions.length?{questions:hwQuestions.map(q=>({type:q.type,stem:q.stem,answer:q.answer}))}:{})});
    const key='lesson-'+crypto.randomUUID();
    const usage=out.materialUsage || [];
    const hwWarn=out.warning || '';
    delete out.materialUsage;
    delete out.warning;
    const materials=usage.filter(m=>m.kind!=='book' && m.from!=='library');
    if (materials.length) out.materials=materials.map(({id,name,chars,kind})=>({id,name,chars,kind}));
    await request(url('deck',key),out);
    $('hwDialog').close();
    await library();await openDeck(key);
    notice((hwWarn?`已生成课后作业「${title}」· ⚠ ${hwWarn}`:`已生成课后作业「${title}」`)+usageNote(usage));
  } finally {btn.disabled=false;$('hwStatus').textContent='';}
});for(const b of document.querySelectorAll('[data-local]'))b.onclick=action(()=>editPage(b.dataset.local));
/* 字号：数字输入，每页独立；回车/失焦生效，一次改动记一步撤销 */
function pageScalePercent(page){
  const m=String(page?.css||'').match(/--page-scale:\s*([\d.]+)/);
  const n=m?Number(m[1]):1;
  return Number.isFinite(n)?Math.round(n*100):100;
}
function syncPageScale(){
  const el=$('pageScale');
  if(!el)return;
  el.value=String(pageScalePercent(deck?.pages[index]));
}
$('pageScale').onchange=action(()=>{
  const raw=Number($('pageScale').value);
  if(!Number.isFinite(raw))throw Error('字号请输入数字（百分比）');
  const pct=Math.min(200,Math.max(50,Math.round(raw)));
  const scale=Math.round(pct)/100;
  const page=deck.pages[index];
  const css=page.css||'', rule=':scope { --page-scale: '+scale+'; }';
  remember('调整字号');
  page.css=scaleRule.test(css)?css.replace(scaleRule,rule):(css+'\n'+rule).trim();
  $('pageScale').value=String(pct);
  changed();
  notice('本页字号 '+pct+'%'+(pct===100?'（恢复默认）':''));
});
$('buildAll').onchange=action(()=>{
  const p=deck.pages[index]; if(!p)return;
  const spec=layout(p);
  if($('buildAll').checked) p.build=true;
  else delete p.build;
  fields();
  changed();
  const manual=spec?buildRows(p,spec).filter(r=>r.build!=null).length:0;
  if(!$('buildAll').checked&&manual)notice(`整页开关已关，但还有 ${manual} 条单独设置了「第几次点击出现」`);
});
for(const b of document.querySelectorAll('[data-ai]'))b.onclick=action(()=>editPage('ai',b.dataset.ai||b.textContent));

/* 选择元素：任意元素都能设「第几次点击出现」（路径与渲染器的节点索引一致） */
function collectBlocks(root) {
  const out = [];
  const containerRe = /(^|\s)(body|grid|notes|steps|cols|cards|points|tasks)(\s|$)/;
  const walk = (parent, path, depth) => {
    Array.from(parent.children).forEach((element, i) => {
      const here = [...path, i];
      // KaTeX 会同时输出 MathML 与 HTML 两份文字，取文本前先去掉副本
      const clone = element.cloneNode(true);
      clone.querySelectorAll('.katex-mathml, annotation, [aria-hidden="true"]').forEach((n) => n.remove());
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text || element.querySelector('img,figure,svg')) {
        out.push({ path: here, tag: element.tagName.toLowerCase(), cls: element.className || '', text: text.slice(0, 42), depth });
      }
      if (depth + 1 < 3 && containerRe.test(String(element.className || ''))) walk(element, here, depth + 1);
    });
  };
  walk(root, [], 0);
  return out;
}

$('pickBlocks').onclick=action(async()=>{
  const p=deck.pages[index]; if(!p)return;
  const {token}=await request(url('draft'),deck);
  const html=await (await fetch(url('preview')+'&draft='+token+'#'+(index+1))).text();
  const doc=new DOMParser().parseFromString(html,'text/html');
  const slide=doc.getElementById('p'+(index+1));
  if(!slide)throw Error('这一页暂时没有可选元素');
  const blocks=collectBlocks(slide);
  const saved=new Map((p.buildBlocks||[]).map(b=>[(b.path||[]).join('.'),{group:b.group??b.g,anim:b.anim||''}]));
  const maxGroup=Math.max(0,...[...saved.values()].map(v=>v.group||0));
  const ANIMS=[['','跟随页面'],['fade','淡入'],['blur','模糊进入'],['fade-up','上移'],['fade-down','下移'],['slide-left','左滑'],['slide-right','右滑'],['scale','缩放'],['zoom','放大进入'],['rotate','轻旋'],['flip','翻转'],['bounce','弹入'],['none','无']];
  const list=$('blockList'); list.replaceChildren();
  for(const b of blocks){
    const key=b.path.join('.');
    const hit=saved.get(key);
    const row=el('label'); row.className='blockRow';
    const box=el('input'); box.type='checkbox'; box.checked=saved.has(key); box.dataset.path=key;
    const pick=el('select'); pick.disabled=!box.checked; pick.className='groupPick';
    const top=Math.max(3,Math.min(9,Math.max(maxGroup+1,hit?.group??1)));
    for(let i=1;i<=top;i++)pick.append(new Option(`第 ${i} 次`,String(i)));
    pick.value=String(hit?.group??Math.min(9,maxGroup+1));
    // 元素级入场动效：空值=跟随页面设置
    const anim=el('select'); anim.disabled=!box.checked; anim.className='animPick';
    for(const [value,text] of ANIMS) anim.append(new Option('动效：'+text,value));
    anim.value=hit?.anim||'';
    box.onchange=()=>{pick.disabled=!box.checked;anim.disabled=!box.checked;};
    const name=el('span',`${'·'.repeat(b.depth)} ${b.tag}：${b.text||'(无文字)'}`);
    name.className='blockName';
    row.append(box,name,pick,anim);
    list.append(row);
  }
  $('blocksDialog').showModal();
});
$('blocksCancel').onclick=()=>$('blocksDialog').close();
$('blocksSave').onclick=action(()=>{
  const p=deck.pages[index]; if(!p)return;
  const blocks=[];
  for(const row of $('blockList').children){
    const box=row.querySelector('input[type=checkbox]');
    const pick=row.querySelector('.groupPick');
    const anim=row.querySelector('.animPick');
    if(!box.checked)continue;
    const entry={path:box.dataset.path.split('.').map(Number),group:Number(pick.value)};
    if(anim?.value)entry.anim=anim.value;
    blocks.push(entry);
  }
  if(blocks.length)p.buildBlocks=blocks; else delete p.buildBlocks;
  delete p.build;
  $('buildAll').checked=false;
  $('blocksDialog').close();
  fields(); changed();
  notice(blocks.length?`已设置 ${blocks.length} 个元素按点击出现`:'已取消所有点击出现设置');
});
$('command').onsubmit=e=>{e.preventDefault();action(()=>editPage('ai',$('instruction').value.trim()))();};
$('undo').onclick=action(()=>{
  const last=histories.get(name)?.pop();
  if(last){
    if (last.tweakKey) tweakCounts.set(last.tweakKey, tweakCounts.get(last.tweakKey) - 1);
    index=Math.min(last.index??0, (last.deck.pages?.length||1)-1);
    install(last.deck,true);
    notice(last.label?('已撤销：'+last.label):('已撤销第 '+(index+1)+' 页修改'));
    preview(90);
  }
  $('undo').disabled=!histories.get(name)?.length;
});

const examDialog=$('examDialog');
let examOriginal='';
let examQuestions=[];
let examUrls=[];
function clearExamOutput() {
  for (const address of examUrls) URL.revokeObjectURL(address);
  examUrls=[];
  $('examLinks').replaceChildren();
  $('examStatus').textContent='';
}
function resetExamRecognition() {
  clearExamOutput();
  examOriginal='';
  $('examSavePaper').disabled=false;
  examQuestions=[];
  $('examQuestions').replaceChildren();
  $('examUnparsed').replaceChildren();
  $('examSummary').textContent='';
  $('examReview').hidden=true;
  $('examGenerate').disabled=true;
}
function selectedQuestions() {
  return [...$('examQuestions').querySelectorAll('input:checked')].map(box=>examQuestions[Number(box.value)]);
}
function setExamBusy(busy) {
  $('examFields').disabled=busy;
  $('examClose').disabled=busy;
  $('examGenerate').disabled=busy || !selectedQuestions().length || examUrls.length>0;
}
$('newExam').onclick=action(async()=>{
  const papers=await request('/api/papers');
  $('examPaper').replaceChildren(new Option('请选择试卷',''),...papers.map(p=>new Option(paperLabel(p),p.id)));
  const bank=await request('/api/question-bank').catch(()=>[]);
  $('examBank').replaceChildren(new Option('（不用题库）',''),...bank.map(b=>new Option(b.title+' · '+b.count+' 题',b.filename)));
  resetExamRecognition();
  const materials=deck?.materials || [];
  $('examMaterials').replaceChildren(...materials.map(item=>new Option(item.name,item.id)));
  $('examMaterialLabel').hidden=!materials.length;
  $('examTitle').value=deck?.meta?.title ? deck.meta.title+' · 题单' : '课堂题单';
  if ($('examAiTopic')) $('examAiTopic').value=deck?.meta?.title || '';
  if ($('examAiBrief')) $('examAiBrief').value='';
  if ($('examAiBook')) await loadBookSelector('examAi').catch(()=>{});
  syncExamQuotaTotal();
  $('examText').value='';
  $('examFile').value='';
  examDialog.showModal();
});
function syncExamQuotaTotal(){
  const ids=['examCntSingle','examCntMulti','examCntJudge','examCntBlank','examCntEssay'];
  const total=ids.reduce((s,id)=>s+Math.max(0,Number($(id)?.value||0)),0);
  if($('examCntTotal')) $('examCntTotal').textContent=`共 ${total} 题（上限 30 题）`;
}
for(const id of ['examCntSingle','examCntMulti','examCntJudge','examCntBlank','examCntEssay']){
  $(id)?.addEventListener('input',syncExamQuotaTotal);
}
$('examAiGo')?.addEventListener('click',action(async()=>{
  const topic=$('examAiTopic').value.trim() || $('examTitle').value.trim();
  if(!topic)throw Error('请先填写出题范围或课题');
  const counts={
    single:Number($('examCntSingle').value||0),
    multi:Number($('examCntMulti').value||0),
    judge:Number($('examCntJudge').value||0),
    blank:Number($('examCntBlank').value||0),
    essay:Number($('examCntEssay').value||0),
  };
  const btn=$('examAiGo');
  btn.disabled=true;
  $('examStatus').textContent='AI 正在按题型与自由度出卷（约 15–45 秒）…';
  try{
    const paperId=$('examPaper')?.value;
    const out=await request('/api/generate-exam',{
      deckName:name,
      title:topic,
      grade:$('examAiGrade').value,
      freedom:$('examAiFreedom').value,
      difficulty:$('examAiDifficulty').value,
      brief:$('examAiBrief').value.trim(),
      counts,
      ...pickedBook('examAi'),
      ...(paperId?{papers:[paperId]}:{}),
    });
    $('examText').value=out.markdown;
    if(!$('examTitle').value.trim()) $('examTitle').value=topic+' · 试卷';
    $('examStatus').textContent=out.warning?`${out.warning}，正在自动识别题目…`:`已生成 ${out.total} 道题，正在自动识别题目…`;
    $('examParse').click();
    notice(out.warning?`AI 出卷完成：${out.warning}`:`AI 已生成 ${out.total} 道题，可在下方勾选删改后导出试卷`);
  } finally {
    btn.disabled=false;
  }
}));
$('examBank').onchange=action(async()=>{
  const file=$('examBank').value;
  if(!file)return;
  setExamBusy(true);
  resetExamRecognition();
  try{
    const sheet=await request('/api/question-bank?file='+encodeURIComponent(file));
    $('examText').value=sheet.markdown;
    $('examFile').value='';
    $('examPaper').value='';
    $('examTitle').value=sheet.title||'课堂题单';
    notice('已从题库载入「'+(sheet.title||file)+'」，可以识别/改题后再出卷');
  }finally{setExamBusy(false);}
});
$('examPaper').onchange=action(async()=>{
  const id=$('examPaper').value;
  if(!id)return;
  setExamBusy(true);
  resetExamRecognition();
  try{
    const paper=await request('/api/paper?id='+encodeURIComponent(id));
    $('examText').value=paper.text;
    $('examFile').value='';
    $('examTitle').value=paper.title;
  }finally{setExamBusy(false);}
});
$('examFile').onchange=async()=>{
  const file=$('examFile').files[0];
  if (!file) return;
  resetExamRecognition();
  setExamBusy(true);
  try {
    const text=await readMaterialFile(file);
    if (!text.trim()) throw Error('没读到文字，可能是扫描件或全是图片');
    $('examText').value=text;
  } catch(err) {
    $('examFile').value='';
    $('examStatus').textContent=err.message;
  } finally { setExamBusy(false); }
};
$('examText').oninput=resetExamRecognition;
$('examSavePaper').onclick=async()=>{
  setExamBusy(true);
  try {
    const title=$('examFile').files[0]?.name || $('examTitle').value.trim() || '课堂题单';
    const result=await request('/api/material',{name:'试卷参考 · '+title,text:examOriginal,kind:'paper'});
    await saveMaterials([...(deck.materials||[]),result.material]);
    $('examSavePaper').disabled=true;
    $('examStatus').textContent='已作为题目参考挂到本课件，生成时会参考它的题型与难度';
  } catch(err) { $('examStatus').textContent=err.message; }
  finally { setExamBusy(false); }
};
$('examMaterials').onchange=resetExamRecognition;
$('examQuestions').onchange=$('examTitle').oninput=()=>{
  clearExamOutput();
  setExamBusy(false);
};
$('examClose').onclick=()=>examDialog.close();
examDialog.oncancel=e=>{ if ($('examFields').disabled) e.preventDefault(); };
examDialog.onclose=clearExamOutput;
$('examParse').onclick=async()=>{
  resetExamRecognition();
  setExamBusy(true);
  $('examSummary').textContent='正在识别题目…';
  try {
    const sources=[];
    for (const option of $('examMaterials').selectedOptions) {
      const {text}=await request('/api/material-text?id='+encodeURIComponent(option.value));
      sources.push({name:option.text,text});
    }
    const pasted=$('examText').value;
    if (pasted.trim()) sources.push({name:'粘贴内容',text:pasted});
    if (!sources.length) throw Error('请选择材料或粘贴题目。');
    const issues=[];
    for (const source of sources) {
      const {questions,unparsed}=await request('/api/parse-questions',{text:source.text});
      for (const q of questions) examQuestions.push(q);
      for (const row of unparsed) issues.push(el('li',source.name+'第 '+row.line+' 行：'+row.reason+'（'+row.text+'）'));
    }
    $('examUnparsed').replaceChildren(...issues);
    const counts=new Map();
    const rows=examQuestions.map((q,i)=>{
      counts.set(q.type,(counts.get(q.type)||0)+1);
      const row=el('label');
      const box=el('input');
      box.type='checkbox';
      box.value=i;
      box.checked=true;
      row.append(box,' '+(i+1)+'. ['+q.type+'] '+q.stem);
      return row;
    });
    $('examQuestions').replaceChildren(...rows);
    examOriginal=sources.map(source=>source.text).join('\n\n');
    $('examReview').hidden=!rows.length;
    $('examSummary').textContent=rows.length
      ? '识别到 '+rows.length+' 题：'+[...counts].map(([type,n])=>type+' '+n).join(' · ')
      : '没识别到题目，请检查题号、题型或选项后重新识别。';
  } catch (err) {
    resetExamRecognition();
    $('examSummary').textContent=err.message;
  } finally { setExamBusy(false); }
};
function examMarkdown(title,questions) {
  const blocks=questions.map((q,i)=>{
    const lines=['### '+(i+1)+'. ['+q.type+'] '+q.stem];
    for (const option of q.options) lines.push('- ['+(option.correct?'x':' ')+'] '+option.text);
    if (q.answer) lines.push('> 答案：'+q.answer);
    if (q.explain) lines.push('> 解析：'+q.explain.replace(/\n/g,'\n> '));
    return lines.join('\n');
  });
  return '# '+title+'\n\n'+blocks.join('\n\n')+'\n';
}
$('examForm').onsubmit=async event=>{
  event.preventDefault();
  if ($('examGenerate').disabled) return;
  const title=$('examTitle').value.trim();
  if (!title) {
    $('examStatus').textContent='请填写题单标题。';
    $('examTitle').focus();
    return;
  }
  const markdown=examMarkdown(title,selectedQuestions());
  setExamBusy(true);
  $('examStatus').textContent='正在生成题单…';
  try {
    const result=await request('/api/question-bank',{markdown});
    for (const [key,label] of [['student','学生版'],['teacher','教师版']]) {
      const address=URL.createObjectURL(new Blob([result[key]],{type:'text/html;charset=utf-8'}));
      examUrls.push(address);
      const link=el('a',label);
      link.href=address;
      link.target='_blank';
      link.rel='noopener';
      const download=el('a','下载'+label);
      download.href=address;
      download.download=result.filename.replace(/\.md$/i,'-'+label+'.html');
      const row=el('div');
      row.append(link,' · ',download);
      $('examLinks').append(row);
    }
    $('examStatus').textContent='已存入题库：'+result.filename;
  } catch (err) {
    $('examStatus').textContent=err.message;
  } finally { setExamBusy(false); }
};

/* 引用题目：从题库勾单题/多题，作为 AI 改写的参考（不照抄原题） */
let aiQuestions=[];
let genQuestions=[], hwQuestions=[];
let questionPickMode='';
const questionCache=new Map();
function ensureQuestionDialog(){
  let d=document.getElementById('aiQuestionDialog');
  if(d)return d;
  d=document.createElement('dialog');
  d.id='aiQuestionDialog';
  d.innerHTML='<form method="dialog"><h2>引用题目</h2><p class="genHint" id="aiQHint"></p><div id="aiQList"></div><button type="button" id="aiQOk">用这些（0 题）</button><button type="button" id="aiQCancel">关闭</button></form>';
  // 关闭按钮在这里绑定一次：后面任何提前 return（比如题库为空）都不会让它失效
  d.querySelector('#aiQCancel').onclick=()=>d.close();
  d.querySelector('#aiQOk').onclick=()=>d.close();
  document.body.append(d);
  return d;
}
async function openQuestionPicker(mode=''){
  questionPickMode=mode;
  const d=ensureQuestionDialog();
  const listEl=d.querySelector('#aiQList'), hint=d.querySelector('#aiQHint'), ok=d.querySelector('#aiQOk');
  hint.textContent='正在读取题库…';
  listEl.replaceChildren();
  questionCache.clear();
  const bank=await request('/api/question-bank').catch(()=>[]);
  if(!bank.length){hint.textContent='题库还是空的：先去「新建试卷」生成一份题单并保存，再来引用。';d.showModal();return;}
  const bucket=mode==='gen'?genQuestions:mode==='hw'?hwQuestions:aiQuestions;
  const picked=new Set((mode?bucket:aiQuestions).map(q=>q.file+'#'+q.no));
  let total=0;
  for(const sheet of bank.slice(0,8)){
    const parsed=await request('/api/question-bank?parsed=1&file='+encodeURIComponent(sheet.filename)).catch(()=>null);
    if(!parsed?.questions?.length)continue;
    const sec=el('fieldset');
    sec.append(el('legend',(parsed.title||sheet.filename)+'（'+parsed.questions.length+' 题）'));
    for(const q of parsed.questions){
      total+=1;
      const key=parsed.filename+'#'+q.no;
      questionCache.set(key,{file:parsed.filename,no:q.no,type:q.type,stem:q.stem,answer:q.answer});
      const row=el('label');row.className='blockRow';
      const box=el('input');box.type='checkbox';box.checked=picked.has(key);
      box.onchange=()=>{box.checked?picked.add(key):picked.delete(key);ok.textContent='用这些（'+picked.size+' 题）';};
      row.append(box,el('span',q.no+'. ['+q.type+'] '+(q.stem||'').slice(0,40)));
      if(q.answer)row.append(el('small',' 答案 '+String(q.answer).slice(0,12)));
      sec.append(row);
    }
    listEl.append(sec);
  }
  hint.textContent=total?'勾选要参考的题目（可多选），AI 会参考题型与难度，不照抄原题':'题库里没有可用题目';
  ok.textContent='用这些（'+picked.size+' 题）';
  ok.onclick=()=>{
    const list=[...picked].map(k=>questionCache.get(k)).filter(Boolean);
    d.close();
    if(mode==='gen'||mode==='hw'){
      if(mode==='gen')genQuestions=list; else hwQuestions=list;
      const note= mode==='gen'?$('genQuestionsNote'):$('hwQuestionsNote');
      note.textContent=list.length?'已选 '+list.length+' 题':'未选题目';
      notice(list.length?'生成时会参考这 '+list.length+' 道题':'已取消引用题目');
      return;
    }
    aiQuestions=list;
    $('aiQuestionsNote').textContent=aiQuestions.length?'已选 '+aiQuestions.length+' 题':'未选题目';
    notice(aiQuestions.length?'已引用 '+aiQuestions.length+' 道题，AI 改写时会参考':'已取消引用题目');
  };
  d.showModal();
}
$('aiQuestionsPick').onclick=action(()=>openQuestionPicker());
$('genPickAssets').onclick=action(()=>openAssets('gen'));
$('hwPickAssets').onclick=action(()=>openAssets('hw'));

/* 单页讲稿：让 AI 按这页内容写一段 */
$('aiNotes').onclick=action(()=>editPage('ai','为这一页写一段教师讲稿：2~4 句口语化的话，60~120 字，包含先问什么、再讲什么、点哪个易错点；不要复述页面上的文字。'));

/* 一键补全：只写还没有讲稿的页，一次调用，一步撤销 */
$('aiNotesAll').onclick=action(async()=>{
  const pages=deck.pages||[];
  const missing=pages.filter(p=>!String(p.notes||'').trim()).length;
  if(!missing)throw Error('每一页都有讲稿了');
  if(!confirm('有 '+missing+' 页还没有讲稿，现在用 AI 写？大约 20~40 秒。'))return;
  $('aiNotesAll').disabled=true;
  $('notesState').textContent='正在生成讲稿…';
  try{
    const {notes}=await request('/api/notes',{name,deck});
    remember('AI 补全讲稿');
    let applied=0;
    for(const n of notes){const p=deck.pages[n.index-1];if(p){p.notes=n.text;applied+=1;}}
    draw();changed();
    $('teacherNotes').value=deck.pages[index]?.notes||'';
    notice('已补全 '+applied+' 页讲稿 · 可撤销');
  }finally{
    $('aiNotesAll').disabled=false;
    $('notesState').textContent='';
  }
});

/* 压到字数内：只在真的超字上限时才有意义，交给 AI 改写而不是生硬截断 */
$('aiFit').onclick=action(()=>editPage('ai','这一页有字段超过字数上限：请在保留公式、关键数字和要点的前提下把话说短，压到上限以内；不要删掉整条。'));

/* 生成整课时引用题库题目 */
$('genPickQuestions').onclick=action(()=>openQuestionPicker('gen'));
$('hwPickQuestions').onclick=action(()=>openQuestionPicker('hw'));

/* 演示块：内置参数化数学模板 + AI 生成自包含小组件，放到本页 */
const WIDGET_SAMPLES = {
  'quadratic-explorer': '二次函数 y = ax^2 + bx + c 参数滑块探究（a=1, b=-2, c=-3）',
  'linear-explorer': '一次函数 y = kx + b 斜率与截距探究（k=1.5, b=1）',
  'trig-explorer': '三角函数 y = A sin(ωx + φ) 振幅周期相位变换',
  'geometry-glider': '矩形动点 P 运动与 △ABP 分段面积函数探究',
  'pythagoras-visual': '勾股定理直角边 a=3, b=4 与三正方形面积验证',
  'step-derivation': '配方法推导二次函数顶点式的分步交互卡片',
};
if ($('widgetTemplate')) {
  $('widgetTemplate').onchange = () => {
    const tpl = $('widgetTemplate').value;
    if (WIDGET_SAMPLES[tpl]) $('widgetBrief').value = WIDGET_SAMPLES[tpl];
  };
}
let wlData = null, wlSubj = 'all';
function insertWidgetBlock(block, msg) {
  remember('添加演示块');
  (deck.pages[index].freeBlocks ??= []).push(block);
  selectedFree = block.id;
  $('widgetDialog').close();
  showFreeForm();
  return changed(0).then(() => notice(msg));
}
function renderWidgetLibrary() {
  const grid = $('wlGrid');
  if (!grid || !wlData) return;
  const q = ($('wlSearch')?.value || '').trim().toLowerCase();
  const all = [
    ...(wlData.local || []),
    ...(wlData.builtin || []),
    ...(wlData.phet || []),
  ].filter((item) => {
    if (wlSubj !== 'all' && item.subject !== wlSubj) return false;
    if (!q) return true;
    return [item.title, item.desc, item.subject, ...(item.tags || [])].join(' ').toLowerCase().includes(q);
  });
  grid.replaceChildren();
  if (!all.length) {
    grid.append(el('p', '没有匹配的实验，可切换学科、清空搜索，或切到「参数模板 / AI」定制。'));
    return;
  }
  for (const item of all) {
    const card = el('div'); card.className = 'wlCard';
    const top = el('div'); top.className = 'wlCardTop';
    const badges = el('div'); badges.className = 'wlBadges';
    const subjBadge = el('span', item.subject); subjBadge.className = 'wlBadge';
    badges.append(subjBadge);
    if (item.source === 'builtin') {
      const b = el('span', '内置秒出'); b.className = 'wlBadge is-builtin'; badges.append(b);
    } else if (item.source === 'phet') {
      const b = el('span', item.cached ? 'PhET · 已缓存' : 'PhET · 按需拉取');
      b.className = 'wlBadge ' + (item.cached ? 'is-cached' : 'is-phet');
      badges.append(b);
    } else if (item.source === 'embed') {
      const b = el('span', `${item.provider || '外链'} · 联网嵌入`); b.className = 'wlBadge is-phet'; badges.append(b);
    } else {
      const b = el('span', '本地导入'); b.className = 'wlBadge is-cached'; badges.append(b);
    }
    top.append(el('strong', item.title), badges);
    const desc = el('p', item.desc || '');
    const act = el('div'); act.className = 'wlCardAct';
    const useBtn = button('插入本页', async () => {
      useBtn.disabled = true;
      try {
        if (item.source === 'builtin') {
          $('widgetStatus').textContent = '正在生成内置参数化组件…';
          const out = await request('/api/widget', { name, instruction: WIDGET_SAMPLES[item.id] || item.title, templateId: item.id, subject: item.subject });
          await insertWidgetBlock({ id: crypto.randomUUID(), type: 'widget', html: out.html, x: 180, y: 140, w: 920, h: 460 }, `已插入「${item.title}」（离线可用 · 可撤销）`);
        } else if (item.source === 'phet') {
          $('widgetStatus').textContent = item.cached ? '正在加载本地缓存…' : `正在联网拉取 PhET 中文实验「${item.title}」（首次约 5~15 秒，拉取后永久本地缓存）…`;
          const res = await request('/api/widget-library/fetch', { id: item.slug });
          item.cached = true;
          await insertWidgetBlock({ id: crypto.randomUUID(), type: 'widget', widgetRef: res.widgetRef, x: 100, y: 80, w: 1080, h: 580 }, `已插入 PhET 实验「${res.title}」（${(res.bytes / 1024 / 1024).toFixed(1)} MB · 已本地缓存，上课断网可用）`);
        } else if (item.source === 'embed') {
          await insertWidgetBlock({ id: crypto.randomUUID(), type: 'widget', embedUrl: item.embedUrl, x: 100, y: 80, w: 1080, h: 580, contentScale: 85 }, `已插入在线互动「${item.title}」（联网可互动，微调模式可调内容缩放或一键铺满）`);
        } else {
          await insertWidgetBlock({ id: crypto.randomUUID(), type: 'widget', widgetRef: item.widgetRef, x: 100, y: 80, w: 1080, h: 580 }, `已插入本地演示「${item.title}」（上课断网可用）`);
        }
      } finally {
        useBtn.disabled = false;
        $('widgetStatus').textContent = '';
      }
    });
    useBtn.className = 'primary';
    act.append(useBtn);
    if (item.source === 'local' || item.source === 'embed') {
      act.append(button('删除', async () => {
        if (!confirm(`确定从演示库删除「${item.title}」吗？`)) return;
        const res = await fetch('/api/widget-library?id=' + encodeURIComponent(item.widgetRef), { method: 'DELETE' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw Error(body.error || '删除失败');
        await loadWidgetLibrary();
        notice(`已删除演示「${item.title}」`);
      }));
    }
    card.append(top, desc, act);
    grid.append(card);
  }
}
async function loadWidgetLibrary() {
  wlData = await request('/api/widget-library');
  renderWidgetLibrary();
  const portals = $('wlPortalList');
  if (portals && wlData.portals) {
    portals.replaceChildren(...wlData.portals.map((p) => {
      const a = el('a'); a.className = 'wlPortal'; a.href = p.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.append(el('strong', `${p.name}（${p.subject}）↗`), el('small', p.tip));
      return a;
    }));
  }
}
if ($('wlModeTabs')) {
  $('wlModeTabs').onclick = (e) => {
    const btn = e.target.closest('button[data-wlmode]');
    if (!btn) return;
    const isLib = btn.dataset.wlmode === 'library';
    for (const b of $('wlModeTabs').querySelectorAll('button')) b.classList.toggle('active', b === btn);
    $('wlLibraryPane').hidden = !isLib;
    $('wlCustomPane').hidden = isLib;
  };
}
if ($('wlSubjTabs')) {
  $('wlSubjTabs').onclick = (e) => {
    const btn = e.target.closest('button[data-subj]');
    if (!btn) return;
    wlSubj = btn.dataset.subj;
    for (const b of $('wlSubjTabs').querySelectorAll('button')) b.classList.toggle('active', b === btn);
    renderWidgetLibrary();
  };
}
if ($('wlSearch')) $('wlSearch').oninput = renderWidgetLibrary;
if ($('wlEmbedBtn')) {
  $('wlEmbedBtn').onclick = action(async () => {
    const url = prompt('粘贴 GeoGebra / Desmos / Falstad / oPhysics 分享链接（https://...）：');
    if (!url || !url.trim()) return;
    const title = prompt('给这个互动演示起个名字（留空自动命名）：', '');
    if (title === null) return;
    const subject = wlSubj !== 'all' ? wlSubj : '数学';
    $('widgetStatus').textContent = '正在转换并保存嵌入链接…';
    const item = await request('/api/widget-library/embed', { url: url.trim(), title: title.trim(), subject });
    await loadWidgetLibrary();
    $('widgetStatus').textContent = `已添加「${item.title}」（${item.provider} 纯净嵌入），点击上方「插入本页」即可使用`;
  });
}
if ($('wlImportBtn')) $('wlImportBtn').onclick = () => $('wlImportFile')?.click();
if ($('wlImportFile')) {
  $('wlImportFile').onchange = action(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) throw Error('演示 HTML 文件超过 12 MB');
    $('widgetStatus').textContent = '正在导入本地离线 HTML 演示…';
    const html = await file.text();
    const subject = wlSubj !== 'all' ? wlSubj : '综合';
    const item = await request('/api/widget-library/import', { title: file.name.replace(/\.html?$/i, ''), subject, filename: file.name, html });
    await loadWidgetLibrary();
    $('widgetStatus').textContent = `已导入「${item.title}」到本地演示库，点击上方「插入本页」即可使用`;
  });
}
$('addWidget').onclick=action(async()=>{
  if(!deck)throw Error('先打开一份课件');
  $('widgetBrief').value='';
  if($('widgetTemplate'))$('widgetTemplate').value='auto';
  $('widgetSubject').value='';
  $('widgetStatus').textContent='';
  await loadWidgetLibrary();
  $('widgetDialog').showModal();
});
$('widgetCancel').onclick=()=>$('widgetDialog').close();
$('widgetGo').onclick=action(async()=>{
  const templateId=$('widgetTemplate')?.value || 'auto';
  const instruction=$('widgetBrief').value.trim();
  if(!instruction && (templateId==='auto' || templateId==='ai-custom'))throw Error('请写一句演示需求，或上方直接选一个内置模板');
  const btn=$('widgetGo'); btn.disabled=true; $('widgetStatus').textContent=templateId!=='ai-custom'?'正在生成组件…':'正在生成（约 20 秒）…';
  try{
    const out=await request('/api/widget',{name,instruction,templateId,subject:$('widgetSubject').value||undefined});
    const b={id:crypto.randomUUID(),type:'widget',html:out.html,x:200,y:150,w:880,h:420};
    remember('添加演示块');
    (deck.pages[index].freeBlocks??=[]).push(b);
    selectedFree=b.id;
    $('widgetDialog').close();
    showFreeForm();
    await changed(0);
    notice((out.note || '演示块已放到本页')+'（'+((out.bytes||0)/1024).toFixed(1)+'KB）· 已匹配当前课件配色 · 可撤销');
  } finally {
    btn.disabled=false;
    $('widgetStatus').textContent='';
  }
});

initTemplateLibrary({
  request,
  notice,
  onCreateWithPack: (packId) => {
    if ([...$('pack').options].some((o) => o.value === packId)) $('pack').value = packId;
    openCreate();
  },
  onGenerateWithPack: (packId, refSlug) => {
    if ([...$('pack').options].some((o) => o.value === packId)) $('pack').value = packId;
    if (refSlug) currentReference = refSlug;
    $('generate').click();
  },
  onTriggerImport: () => $('file').click(),
  onPacksChanged: async () => {
    const prev = $('pack').value;
    packs = await request('/api/packs');
    $('pack').replaceChildren(...packs.map((p) => new Option(p.name, p.id)));
    if (packs.some((p) => p.id === prev)) $('pack').value = prev;
    else if (packs.some((p) => p.id === 'math-junior')) $('pack').value = 'math-junior';
  },
});

const tour = createTour({
  onBeforeStep: (step) => {
    // 若引导步骤指向侧边栏按钮而侧栏当前被收起，自动展开侧栏以免目标不可见
    if ((step.selector === '#generate' || step.selector === '#books') && document.body.classList.contains('side-collapsed')) {
      $('sideToggle')?.click();
    }
  },
});
$('helpTour')?.addEventListener('click', () => tour.start(0));
tour.maybeAutoStart();
