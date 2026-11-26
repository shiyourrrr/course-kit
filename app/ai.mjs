import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { applyMotionRecipes } from './motion-recipes.mjs';
import { WIDGET_SPEC, checkWidget, stripWidgetFence } from '../src/widgets.mjs';
import { detectWidgetTemplate, buildWidgetFromTemplate } from '../src/widget-templates.mjs';
import { renameRetry } from '../src/fs-retry.mjs';
import {fieldsOf,length,shorten} from './edit.mjs';
import {resolveFreedom,homeworkGuidance} from './exam-ai.mjs';
const dir = new URL('../app-data/',import.meta.url);
const file = new URL('settings.json',dir);
const defaults={apiKey:'',model:'deepseek-chat',baseUrl:'https://api.deepseek.com',mineruToken:''};

/**
 * 接口地址白名单式校验：只允许公网 HTTPS（本机回环的 HTTP 例外，方便接本地代理）。
 * 目的是挡住 SSRF：file:、内网段、云元数据地址、带账号密码的 URL 一律拒绝。
 */
export function isSafeBaseUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (url.protocol === 'http:') {
    if (!loopback) return false;          // 公网必须 https
  } else if (url.protocol !== 'https:') {
    return false;                          // 只允许 http(s)
  }
  // 内网 / 保留地址
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    if (host === '127.0.0.1') return true;   // 本机回环：允许接本地代理
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || (a === 169 && b === 254)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0 || a >= 224) return false;
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.includes(':') && !loopback) return false;   // IPv6 只放行 ::1
  return true;
}

export async function settings() {
  try {return JSON.parse(await fs.readFile(file,'utf8'));} catch(e){if(e.code==='ENOENT')return defaults;throw e;}
}
export const publicSettings = ({apiKey,model,baseUrl,mineruToken})=>({configured:!!apiKey,model,baseUrl,mineruConfigured:!!mineruToken});
/** 在 Windows 上用 icacls 收紧凭证文件权限：移除继承的 Users/Authenticated Users 权限，仅当前用户可读写 */
function tightenWindowsAcl(targetPath) {
  if (process.platform !== 'win32') return Promise.resolve();
  const user = process.env.USERNAME || os.userInfo().username;
  if (!user) return Promise.reject(Error('无法识别当前 Windows 用户，未能收紧配置文件权限'));
  return new Promise((resolve, reject) => {
    execFile('icacls', [targetPath, '/inheritance:r', '/grant:r', `${user}:(F)`], { windowsHide: true, timeout: 5000 }, (err) => {
      if (err) return reject(Error('配置已写入但未能收紧本机文件权限，请检查当前账号权限'));
      resolve();
    });
  });
}

export async function saveSettings(input) {
  const old=await settings();
  const model=input.model?.trim(), baseUrl=input.baseUrl?.trim().replace(/\/+$/,'');
  if (!model || !isSafeBaseUrl(baseUrl)) throw Error('接口地址必须是公网 HTTPS（本机 localhost 可用 HTTP）');
  const apiKey=input.apiKey?.trim() ?? (baseUrl===old.baseUrl?old.apiKey:'');
  const mineruToken=input.mineruToken!==undefined ? (input.mineruToken?.trim() || '') : (old.mineruToken || '');
  const next={apiKey,model,baseUrl,mineruToken};
  await fs.mkdir(dir,{recursive:true});
  const temp=new URL(crypto.randomUUID(),dir);
  try {
    await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});
    await renameRetry(temp,file);
    await tightenWindowsAcl(fileURLToPath(file));
  }
  finally {await fs.rm(temp,{force:true});}
  return publicSettings(next);
}
function parseAiJson(raw) {
  let text = String(raw || '').trim();
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const firstBrace = text.search(/[\[{]/);
  if (firstBrace > 0) text = text.slice(firstBrace);
  return JSON.parse(text);
}

export function slotArrayCapacity(spec, basePath) {
  const key = String(basePath || '').split('.').pop();
  const raw = Number(spec?.capacity?.[key]);
  if (Number.isInteger(raw) && raw > 0) return Math.min(raw, 12);
  return 5;
}

export async function ai({pageIndex,instruction,deck,assets,questions},pack,materialSuffix='') {
  const {apiKey,model,baseUrl}=await settings();
  if (!apiKey && process.env.COURSE_KIT_AI_MOCK !== '1') throw Error('先配置 API key');
  const page=deck.pages?.[pageIndex];
  if (!Number.isInteger(pageIndex)||!page||typeof instruction!=='string'||!instruction.trim()) throw Error('请选择当前页并填写修改要求');
  if (/拆成[两二2]页/.test(instruction)) throw Error('当前只能修改这一页的文字，拆页请使用复制页面');
  const fields=fieldsOf(page,pack);
  const spec = pack.layouts?.find(l => l.id === page.layout);
  const metaSkip = new Set(['img','image','figure','svg','background','ctaGoto','goto','id']);
  const scalarSlots = new Set(
    (spec?.slots || [])
      .filter(s => typeof s === 'string' && !s.includes('[') && !metaSkip.has(s.split('.').pop()))
  );
  // 收集当前页型支持的所有数组槽位及其子字段（如 items -> ['num','term','text']）
  const arraySlotMap = new Map();
  for (const s of (spec?.slots || [])) {
    if (typeof s !== 'string' || !s.includes('[].')) continue;
    const [base, child] = s.split('[].');
    if (!arraySlotMap.has(base)) arraySlotMap.set(base, new Set());
    arraySlotMap.get(base).add(child);
  }
  const arraySlotsInfo = [...arraySlotMap.entries()].map(([base, childSet]) => {
    const cap = slotArrayCapacity(spec, base);
    const cur = base.split('.').reduce((o, k) => o?.[k], page);
    return { path: base, itemKeys: [...childSet], currentCount: Array.isArray(cur) ? cur.length : 0, maxItems: cap };
  });
  const editableFields = [
    ...[...fields.entries()].map(([p, f]) => ({ path: p, value: f.value, ...(f.limit ? { max: f.limit } : {}) })),
    ...[...scalarSlots].filter(s => !fields.has(s)).map((s) => {
      const leaf = s.split('.').pop();
      const lim = spec?.slotSpecs?.[s]?.max ?? pack.slots?.[page.layout]?.[s]?.max ?? pack.limits?.[leaf];
      return { path: s, value: '', ...(lim ? { max: lim } : {}) };
    }),
  ];
  const allowedPathSet = new Set(editableFields.map(f => f.path));
  const assetList=Array.isArray(assets)?assets.filter(a=>a&&typeof a.path==='string').slice(0,8):[];
  const assetHint=assetList.length?('\n可用素材（只能填到图片类字段，如 img/figure；也可按指令说明用法与效果）：'+assetList.map(a=>a.path+(a.width?'（'+a.width+'×'+a.height+'）':'')).join('；')):'';
  const questionList=Array.isArray(questions)?questions.filter(q=>q&&q.stem).slice(0,10):[];
  const questionHint=questionList.length?('\n参考题目（学习题型与难度，改写或新出题都不要照抄原题）：\n'+questionList.map((q,i)=>(i+1)+'. ['+(q.type||'')+'] '+String(q.stem).slice(0,200)+(q.answer?'（答案：'+String(q.answer).slice(0,60)+'）':'')).join('\n')):'';
  const arrayHint = arraySlotsInfo.length
    ? ' 若老师要求内容更饱满/多写几条/补充例子或步骤，可直接用 {"op":"set","path":"<数组槽path>","value":[{...}, ...]} 扩充或重写对应数组（条数不超过 maxItems，字段名取自 itemKeys），也可以填补 editableFields 中当前为空的槽位。'
    : ' 若老师要求内容更饱满/多写一点，请扩写现有字段并填补 editableFields 中当前为空的槽位（不超过各自 max）。';
  const messages=[{role:'system',content:'你是中小学课件改写助手。修改当前页内容时，path 必须取自 editableFields 或 arraySlots，保留完整 LaTeX 公式（$...$），遵守 max 字数上限。只输出纯 JSON：{"ops":[{"op":"set","path":"...","value":...}]}，不要 markdown 代码块或解释。'+arrayHint+(assetList.length?' 允许把图片类字段设为给定素材路径。':'')+' 另外可选四类额外操作：{"op":"set","path":"notes","value":"这一页的讲稿"}、{"op":"set","path":"background","value":"<给定素材路径>"}、{"op":"set","path":"veil","value":"0.6"}、{"op":"set","path":"anim","value":"fade|fade-up|fade-down|slide-left|slide-right|scale|blur|zoom|rotate|flip|bounce|none"}。只有老师明确要求配图、背景、讲稿或效果时才输出这四类。'},
    {role:'user',content:JSON.stringify({layout:page.layout,editableFields,arraySlots:arraySlotsInfo,instruction})+assetHint+questionHint+materialSuffix}];
  const signal=AbortSignal.timeout(45000);
  const EXTRA=new Set(['notes','background','veil','anim']);
  const ANIMS=new Set(['fade','blur','fade-up','fade-down','slide-left','slide-right','scale','zoom','rotate','flip','bounce','none']);
  const normalizePath = (rawPath) => {
    let p = String(rawPath || '').trim().replace(/^page\./, '');
    if (allowedPathSet.has(p) || arraySlotMap.has(p) || EXTRA.has(p)) return p;
    const bracketed = p.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
    if (allowedPathSet.has(bracketed)) return bracketed;
    return bracketed;
  };
  const isAppendArrayField = (p) => {
    const m = /^([\w.]+)\[(\d+)\]\.([\w]+)$/.exec(p);
    if (!m) return false;
    const [, base, idxStr, child] = m;
    const childSet = arraySlotMap.get(base);
    if (!childSet || !childSet.has(child)) return false;
    const cap = slotArrayCapacity(spec, base);
    return Number(idxStr) >= 0 && Number(idxStr) < cap;
  };
  for(let attempt=0;attempt<2;attempt++) {
    let ops;
    if(process.env.COURSE_KIT_AI_MOCK==='1'){
      const firstPath = fields.has('stem') ? 'stem' : (editableFields[0]?.path || 'title');
      let prefix=Array.from(String(page[firstPath]||'')).slice(0,20).join('');
      if((prefix.match(/\$/g)||[]).length%2)prefix+='$';
      ops=[{op:'set',path:firstPath,value:'（模拟）'+prefix+'…'}];
    } else {
      try {
        const res=await fetch(baseUrl+'/chat/completions',{method:'POST',redirect:'error',signal,
          headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
          body:JSON.stringify({model,messages,response_format:{type:'json_object'}})});
        if(!res.ok) throw Error([401,403].includes(res.status)?'API key 无效':'模型接口请求失败（'+res.status+'）');
        const payload = parseAiJson((await res.json()).choices?.[0]?.message?.content);
        ops = Array.isArray(payload?.ops) ? payload.ops : (Array.isArray(payload) ? payload : (payload?.op === 'set' ? [payload] : null));
      } catch(e){
        if(signal.aborted)throw Error('模型请求超过 45 秒');
        if(e.message==='fetch failed')throw Error('网络失败，请检查接口地址和连接');
        if(e instanceof TypeError||e instanceof SyntaxError){
          if (attempt === 0) {
            messages.push({role:'user',content:'上一次输出不是合法 JSON，请严格只输出 {"ops":[{"op":"set","path":"...","value":"..."}]}。'});
            continue;
          }
          throw Error('模型返回格式不对');
        }
        throw e;
      }
    }
    if(!Array.isArray(ops)||!ops.length){
      if (attempt === 0) {
        messages.push({role:'user',content:'请输出非空的 ops 数组，path 取自：'+[...allowedPathSet, ...arraySlotMap.keys()].join(', ')});
        continue;
      }
      throw Error('模型返回格式不对');
    }
    const changes=new Map();
    for(const op of ops){
      if(!op || typeof op !== 'object') continue;
      if(op.op && op.op !== 'set') continue;
      const targetPath = normalizePath(op.path);
      // 支持整组数组槽位扩充/改写（如 items / points / steps / tasks / left.items）
      if (arraySlotMap.has(targetPath) && Array.isArray(op.value)) {
        const allowedChildren = arraySlotMap.get(targetPath);
        const cap = slotArrayCapacity(spec, targetPath);
        const sanitizedRows = op.value.slice(0, cap).map((item) => {
          if (!item || typeof item !== 'object') return null;
          const row = {};
          for (const [rk, rv] of Object.entries(item)) {
            if (!allowedChildren.has(rk)) continue;
            if (typeof rv === 'string' || typeof rv === 'number') row[rk] = String(rv).slice(0, 400);
          }
          return Object.keys(row).length ? row : null;
        }).filter(Boolean);
        if (sanitizedRows.length) {
          const prevArr = targetPath.split('.').reduce((o, k) => o?.[k], page);
          if (JSON.stringify(prevArr || []) !== JSON.stringify(sanitizedRows)) {
            changes.set(targetPath, sanitizedRows);
          }
        }
        continue;
      }
      let val = op.value;
      if (typeof val === 'number' || typeof val === 'boolean') val = String(val);
      else if (Array.isArray(val) && val.every(x => typeof x === 'string' || typeof x === 'number')) val = val.join('\n');
      if (typeof val !== 'string') continue;
      if(EXTRA.has(targetPath)){
        if(targetPath==='notes'&&!val.trim())continue;
        if(targetPath==='veil'&&!(Number(val)>=0&&Number(val)<=1))continue;
        if(targetPath==='anim'&&!ANIMS.has(val))continue;
        if(targetPath==='background'&&val&&!assetList.some(a=>a.path===val))continue;
        changes.set(targetPath,val);
        continue;
      }
      if(!allowedPathSet.has(targetPath) && !isAppendArrayField(targetPath)) continue;
      const existingVal = fields.get(targetPath)?.value;
      if (existingVal !== undefined && existingVal === val) continue;
      changes.set(targetPath,val);
    }
    if (!changes.size) {
      if (attempt === 0) {
        messages.push({role:'user',content:'上一次输出没有产生实质修改（或 path 不在允许范围内）。请切实按要求扩充或修改内容，可用 path：'+[...allowedPathSet, ...arraySlotMap.keys()].join(', ')});
        continue;
      }
      throw Error('模型未生成有效修改，请换一种更具体的说法再试');
    }
    const getFieldLimit = (p) => {
      const f = fields.get(p);
      if (f?.limit) return f.limit;
      const slot = p.replace(/\[\d+\]/g, '[]');
      const leaf = p.split('.').pop();
      return spec?.slotSpecs?.[slot]?.max ?? spec?.slotSpecs?.[leaf]?.max ?? pack.slots?.[page.layout]?.[slot]?.max ?? pack.limits?.[leaf];
    };
    const overDetails = [];
    for (const [p, val] of changes.entries()) {
      if (EXTRA.has(p)) continue;
      if (Array.isArray(val)) {
        val.forEach((row, idx) => {
          for (const [rk, rv] of Object.entries(row || {})) {
            if (typeof rv !== 'string' || rk === 'formula') continue;
            const lim = getFieldLimit(`${p}[${idx}].${rk}`);
            if (lim && length(rv) > lim) overDetails.push(`${p}[${idx}].${rk}(当前${length(rv)}字/上限${lim}字)`);
          }
        });
      } else if (typeof val === 'string' && p.split('.').pop() !== 'formula') {
        const lim = getFieldLimit(p);
        if (lim && length(val) > lim) overDetails.push(`${p}(当前${length(val)}字/上限${lim}字)`);
      }
    }
    if (overDetails.length && attempt === 0) {
      messages.push({role:'user',content:'以下字段超过字数上限，请在保留核心内容与公式的前提下精简到各自上限以内：'+overDetails.join('、')});
      continue;
    }
    // 末轮仍略有超出时，对非公式文本做不截断公式的安全收口，避免被前端整体撤销
    if (overDetails.length) {
      for (const [p, val] of changes.entries()) {
        if (EXTRA.has(p)) continue;
        if (Array.isArray(val)) {
          val.forEach((row, idx) => {
            for (const [rk, rv] of Object.entries(row || {})) {
              if (typeof rv !== 'string' || rk === 'formula') continue;
              const lim = getFieldLimit(`${p}[${idx}].${rk}`);
              if (lim && length(rv) > lim) row[rk] = shorten(rv, lim, rk);
            }
          });
        } else if (typeof val === 'string' && p.split('.').pop() !== 'formula') {
          const lim = getFieldLimit(p);
          if (lim && length(val) > lim) changes.set(p, shorten(val, lim, p.split('.').pop()));
        }
      }
    }
    const cleanOps = [...changes.entries()].map(([path, value]) => ({ op: 'set', path, value }));
    return {ops:cleanOps,note:overDetails.length ? '已生成当前页修改（超长字段已自动收口）' : '已生成当前页修改'};
  }
  throw Error('修改后整页文本超过字数预算，请缩短要求');
}

/** 从年级名推断学段：小学 / 初中 / 高中 / 大学（用于调整语言与难度，没识别就留空） */
export function stageOf(grade) {
  const g = String(grade || '').trim();
  if (!g) return '';
  if (/^[一二三四五六]年级/.test(g)) return '小学';
  if (/^[七八九]年级|^初[一二三]/.test(g)) return '初中';
  if (/^高[一二三]/.test(g)) return '高中';
  if (/大学|本科|专科|大一|大二|大三|大四/.test(g)) return '大学';
  return '';
}
const stageRule = (stage) => stage === '小学'
  ? '学段是小学：用词要浅、例子贴近生活、每页信息量少、少用公式推导。'
  : stage === '初中'
    ? '学段是初中：重直观与推导步骤，例题要给完整过程。'
    : stage === '高中'
      ? '学段是高中：重抽象与一般化，可给严谨表述与变式。'
      : stage === '大学'
        ? '学段是大学：可更严谨、可引用教材章节与定义，例题可有计算量。'
        : '';
/** PageIndex 风格目录树兜底：仅发送极简目录让模型挑出最相关的 1~2 个章节编号 */
export async function pickChaptersByToc(tocLines, query) {
  const { apiKey, model, baseUrl } = await settings();
  if (!apiKey || process.env.COURSE_KIT_AI_MOCK === '1' || !tocLines?.length) return [];
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是教材目录定位助手。只输出 JSON：{"chapters":[编号]}，从目录中选出与课题最相关的 1~2 个章节编号；完全无关则返回空数组。' },
        { role: 'user', content: '课题与要求：' + String(query || '').slice(0, 200) + '\n\n教材目录：\n' + tocLines.slice(0, 120).join('\n') },
      ],
    }),
  });
  if (!res.ok) return [];
  const parsed = parseAiJson((await res.json()).choices?.[0]?.message?.content);
  return Array.isArray(parsed?.chapters) ? parsed.chapters.map(Number).filter(Number.isInteger) : [];
}

/** 内容饱满度档位规则（解决 AI 生成过空、只写空泛短语的问题） */
export function densityGuidance(density = 'standard') {
  if (density === 'concise') {
    return '【内容密度：精简板书】每页只保留最核心公式与 2~3 条简短关键词要点，留白充足，适合老师大量口头板书展开。';
  }
  if (density === 'rich') {
    return '【内容密度：详实讲义】每页信息务必高度饱满：列表/要点/步骤类数组槽位尽量填满 4 条（或槽位上限），每个文本槽位充分利用 75%~95% 的可用字数上限；必须写清严格限定条件、具体数值例题、完整分步推导、正反辨析与高频易错坑，严禁空洞口号或只写半句话。';
  }
  return '【内容密度：标准饱满】每页内容要扎实充实，拒绝空洞套话：列表/要点/步骤类数组槽位至少填满 3~4 条，每个文本槽位尽量达到可用字数预算的 65%~90%；概念页写清定义+限定条件+关键词，例题页写清完整题干+破题思路+分步解答+易错提醒，确保直接可上公开课。';
}

/**
 * PPTAgent 风格第 1 阶段：先专注提炼本课核心概念、重难点、高频易错坑与逐页教学任务单，
 * 再把任务单交给第 2 阶段饱满填页（失败时优雅降级，不阻塞生成）。
 */
async function planLessonKeyPoints({ apiKey, model, baseUrl, title, grade, stage, lessonType, brief, pages, layouts, materialSuffix }) {
  if (!apiKey || process.env.COURSE_KIT_AI_MOCK === '1') return null;
  const layoutNames = new Map(layouts.map(l => [l.id, l.name]));
  const pageOutline = pages.map(p => ({ index: p.index, layout: p.layout, name: layoutNames.get(p.layout) || p.layout }));
  const excerpt = materialSuffix ? materialSuffix.slice(0, 12000) : '';
  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(22000),
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是资深教研员，负责课前「重难点教学设计」。只输出 JSON：{"coreConcept":"一句话核心思想","keyPoints":["重点1","重点2","重点3"],"pitfalls":["高频易错点1","高频易错点2"],"pagePlan":[{"index":1,"focus":"本页要落地的具体知识点/例题数值/正反辨析"}]}。要求：紧扣课题与教材，拒绝空泛套话；pagePlan 必须覆盖全部页号，每页给出具体教学落点。',
          },
          {
            role: 'user',
            content: JSON.stringify({ title, grade, stage, lessonType, brief, pages: pageOutline }) + excerpt,
          },
        ],
      }),
    });
    if ([401, 403].includes(res.status)) {
      const err = Error('API key 无效');
      err.noRetry = true;
      throw err;
    }
    if (!res.ok) return null;
    const plan = parseAiJson((await res.json()).choices?.[0]?.message?.content);
    return plan && typeof plan === 'object' ? plan : null;
  } catch (e) {
    if (e?.noRetry) throw e;
    return null;
  }
}

/** 一句话生成整节课 / 课后作业：两阶段（先抓重难点规划 -> 再饱满填页），服务端负责校验与兜底 */
export async function generateDeck(input, pack, skeleton, materialSuffix = '') {
  const { apiKey, model, baseUrl } = await settings();
  if (!apiKey && process.env.COURSE_KIT_AI_MOCK !== '1') throw Error('先配置 API Key（右上角 ⚙），再用「一句话生成」');
  const { title = '未命名课件', grade = '', lessonType = 'new', brief = '', mode = 'lesson', density = 'standard', assets, questions, questionCount, freedom, difficulty } = input || {};
  const hwCfg = mode === 'homework' ? homeworkGuidance({ questionCount, freedom, difficulty }) : null;
  const reqTemperature = mode === 'homework' ? hwCfg.temperature : (freedom ? resolveFreedom(freedom).temperature : undefined);
  const stage = stageOf(grade);
  if (!String(title).trim()) throw Error('请填写课题');
  if (!pack?.layouts?.length) throw Error('模板包不可用');

  const layouts = pack.layouts.map(({ id, name, slots, capacity }) => ({ id, name: name || id, slots: slots || [], ...(capacity ? { capacity } : {}) }));
  const pages = skeleton.map((page, i) => ({ index: i + 1, layout: page.layout, values: page.values || {} }));
  const teachingPlan = mode === 'lesson'
    ? await planLessonKeyPoints({ apiKey, model, baseUrl, title, grade, stage, lessonType, brief, pages, layouts, materialSuffix })
    : null;
  const assetList = Array.isArray(assets) ? assets.filter(a => a && typeof a.path === 'string').slice(0, 24) : [];
  const allowedAssets = new Set(assetList.map(a => a.path));
  const assetHint = assetList.length
    ? '\n可用素材（只能用来填图片类槽位，例如 img / figure / 图片字段；不合适的槽位就留空）：\n' + assetList.map((a, i) => (i + 1) + '. ' + a.path + (a.width ? '（' + a.width + '×' + a.height + '）' : '')).join('\n')
    : '';
  const hasPageAnchors = /\[P\d+\]/.test(materialSuffix);
  const groundingHint = hasPageAnchors
    ? ' 教材原文中带有 [P页码] 标记：定义、定理、核心例题必须严格依据所给教材原文（不要编造教材未出现的数字或结论），并在每页对象上额外返回 "textbookPages" 字段标明本页依据的教材页码范围（如 "P22–24" 或 "P22、P25"）。'
    : '';
  const planHint = teachingPlan
    ? ' 已提供 teachingPlan（本课核心概念、重难点、易错坑与逐页教学任务）：每页必须严格落实对应 index 的 focus，并把 keyPoints 与 pitfalls 扎实融入各页正文与例题中。'
    : '';
  const system = mode === 'homework'
    ? `你是中小学老师，正在出一份课后作业。只输出 JSON：{"pages":[{"index":1,"values":{...}}]}，不要 markdown、不要解释。
规则：页数固定，只填 values；values 的 key 必须是该页 layout 的 slots 字段名，数组字段给数组；每题给清晰解析与答案；公式用 $...$；中文；每题正文≤120字。若提供了 slotBudgets，各字段字数必须严格 ≤ 对应 max。` + hwCfg.prompt + groundingHint
    : `你是中小学资深教研员与课件设计助手。只输出 JSON：{"pages":[{"index":1,"values":{...},"notes":"..."}]}，不要 markdown、不要解释。
规则：页数固定，只填 values；values 的 key 必须是该页 layout 的 slots 字段名，数组字段给数组（元素是对象）；公式用 $...$；中文；标题≤26字、正文≤90字、条目≤60字（若提供了 slotBudgets，每页各字段字数必须严格 ≤ 对应 max，尤其是短文本框页）；内容要贴合课题、年级与课型。` + densityGuidance(density) + planHint + ` 每页额外给 notes 字段：老师上课口述的讲稿，2~4 句口语化的话（70~130 字），要包含「先问什么、再讲什么、点哪个易错点」，不要复述页面上的文字。` + (assetList.length ? ' 图片类字段只能取给定素材路径。' : '') + groundingHint;
  const genQuestions = Array.isArray(questions) ? questions.filter(q => q && q.stem).slice(0, 10) : [];
  const questionHint = genQuestions.length
    ? '\n参考题目（学习它们的题型、设问方式与难度；生成新题时不要照抄原题）：\n' + genQuestions.map((q, i) => (i + 1) + '. [' + (q.type || '') + '] ' + String(q.stem).slice(0, 200) + (q.answer ? '（答案：' + String(q.answer).slice(0, 60) + '）' : '')).join('\n')
    : '';
  const user = JSON.stringify({ title, grade, stage, lessonType, brief, mode, density, layouts, pages, ...(teachingPlan ? { teachingPlan } : {}), ...(input?.slotBudgets ? { slotBudgets: input.slotBudgets } : {}), reference: input?.referenceData || null }) + (stageRule(stage) ? '\n' + stageRule(stage) : '') + assetHint + questionHint + materialSuffix;

  let parsed = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (process.env.COURSE_KIT_AI_MOCK === '1') {
      parsed = { pages: pages.map((p) => ({ index: p.index, values: mockValues(p.layout, layouts, title, brief, input?.slotBudgets) })) };
      break;
    }
    const signal = AbortSignal.timeout(90000);
    try {
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, ...(reqTemperature != null ? { temperature: reqTemperature } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } }),
      });
      if ([401, 403].includes(res.status)) {
        const err = Error('API key 无效');
        err.noRetry = true;
        throw err;
      }
      if (!res.ok) throw Error('模型接口请求失败（' + res.status + '）');
      parsed = parseAiJson((await res.json()).choices?.[0]?.message?.content);
      break;
    } catch (e) {
      if (e?.noRetry) throw e;
      if (signal.aborted) {
        if (attempt === 1) throw Error('生成超过 90 秒，请减少页数或稍后再试');
        continue;
      }
      if (e.message === 'fetch failed') {
        if (attempt === 1) throw Error('网络失败，请检查接口地址和连接');
        continue;
      }
      if (e instanceof SyntaxError) {
        if (attempt === 1) throw Error('模型返回格式不对');
        continue;
      }
      if (attempt === 1) throw e;
    }
  }
  if (!Array.isArray(parsed?.pages)) throw Error('模型返回格式不对');

  const byIndex = new Map(parsed.pages.map((p) => [Number(p?.index), p?.values || {}]));
  // 讲稿与教材页码溯源：跟 values 平级返回，单独收（不属于任何 slot）
  const notesByIndex = new Map(parsed.pages.map((p) => [Number(p?.index), typeof p?.notes === 'string' ? p.notes.trim() : '']));
  const bookPagesByIndex = new Map(parsed.pages.map((p) => [Number(p?.index), typeof p?.textbookPages === 'string' ? p.textbookPages.trim() : '']));
  const merged = skeleton.map((page, i) => {
    const spec = layouts.find((l) => l.id === page.layout) || { slots: [] };
    const values = byIndex.get(i + 1) || {};
    const out = { layout: page.layout };
    if (mode !== 'homework' && notesByIndex.get(i + 1)) out.notes = notesByIndex.get(i + 1).slice(0, 600);
    if (bookPagesByIndex.get(i + 1)) out.textbookPages = bookPagesByIndex.get(i + 1).slice(0, 60);
    for (const slot of spec.slots) {
      const base = slot.split('[].')[0];
      const key = base.split('.').pop();
      const child = slot.split('[].')[1];
      if (!(key in values)) continue;
      const value = values[key];
      if (child) {
        if (!Array.isArray(value)) continue;
        const cap = slotArrayCapacity(spec, base);
        // 作业多页分摊：保留原始数组供下方跨页重排，常规槽位直接按容量截断
        const sliceLimit = (mode === 'homework' && key === 'tasks' && (page.layout === 'homework' || page.layout === 'elastic-homework')) ? 30 : cap;
        out[key] = value.slice(0, sliceLimit).map((item) => {
          const row = {};
          if (item && typeof item === 'object') for (const [k, v] of Object.entries(item)) if (typeof v === 'string' || typeof v === 'number') row[k] = String(v).slice(0, 400);
          return row;
        });
      } else if (typeof value === 'string' || typeof value === 'number') {
        out[key] = String(value).slice(0, 4000);
      }
    }
    return out;
  });
  let homeworkWarning = '';
  if (mode === 'homework' && hwCfg) {
    const hwPages = merged.filter((p) => p.layout === 'homework' || p.layout === 'elastic-homework');
    if (!hwPages.length) {
      throw Error('当前模板不含作业页型，无法生成课后作业');
    }
    const caps = hwPages.map((p) => slotArrayCapacity(layouts.find((l) => l.id === p.layout), 'tasks'));
    // 合并所有作业页有效非空 tasks（必须具备实际渲染的题干字段 text），按目标题量硬裁剪，再按页容量顺序均匀填满
    const allTasks = hwPages
      .flatMap((p) => (Array.isArray(p.tasks) ? p.tasks : []))
      .filter((t) => t && typeof t === 'object' && typeof t.text === 'string' && t.text.trim().length > 0);
    const clamped = allTasks.slice(0, hwCfg.count);
    let cursor = 0;
    for (let idx = 0; idx < hwPages.length; idx++) {
      const take = Math.min(caps[idx], clamped.length - cursor);
      hwPages[idx].tasks = clamped.slice(cursor, cursor + take);
      cursor += take;
    }
    const actualTasks = cursor;
    if (actualTasks === 0) {
      throw Error('模型未生成有效课后作业题目，请重试');
    }
    if (actualTasks < hwCfg.count) {
      homeworkWarning = `实际生成 ${actualTasks}/${hwCfg.count} 题（可在作业页手动补充）`;
    }
  }
  // 动效由页型配方决定（AI 只填文字）：让每页有点变化，同时保持统一风格，老师仍可在页面工具里改
  // 防编造：只在真的给了素材清单时校验（否则保持 AI 原值，兼容没配素材的旧行为）
  const imageKeys = new Set(['img','image','figure','picture','photo','background']);
  if (allowedAssets.size) for (const page of merged) {
    for (const [key, value] of Object.entries(page)) {
      if (!imageKeys.has(key) || typeof value !== 'string') continue;
      if (!value) continue;
      if (!allowedAssets.has(value)) delete page[key];
    }
    if (Array.isArray(page.items)) {
      for (const item of page.items) {
        for (const [key, value] of Object.entries(item || {})) {
          if (!imageKeys.has(key) || typeof value !== 'string' || !value) continue;
          if (!allowedAssets.has(value)) delete item[key];
        }
      }
    }
  }
  return {
    pack: pack.id,
    meta: { title: String(title), grade: String(grade) },
    ...(homeworkWarning ? { warning: homeworkWarning } : {}),
    pages: applyMotionRecipes(merged),
  };
}

function mockValues(layoutId, layouts, title, brief, slotBudgets) {
  const spec = layouts.find((l) => l.id === layoutId) || { slots: [] };
  const budgetMap = slotBudgets?.[layoutId] || {};
  const clip = (str, slotKey) => {
    const max = budgetMap[slotKey]?.max;
    return max ? Array.from(String(str)).slice(0, max).join('') : str;
  };
  const values = {};
  let n = 1;
  for (const slot of spec.slots) {
    const child = slot.split('[].')[1];
    const key = slot.split('[].')[0].split('.').pop();
    if (child) {
      values[key] = [
        { [child]: clip('（模拟）' + (brief || title) + ' 要点 ' + n++, slot) },
        { [child]: clip('（模拟）核心规律推导与应用', slot) },
      ];
    } else if (/title|term|kicker|name/.test(key)) {
      values[key] = clip('（模拟）' + title, slot);
    } else if (/text|lead|stem|answer|note|explain/.test(key)) {
      values[key] = clip('（模拟内容）' + (brief || title) + '。', slot);
    } else {
      values[key] = clip(title + ' · ' + key, slot);
    }
  }
  return values;
}
/** 批量写讲稿：一次请求，只写还没有讲稿的页（返回 [{index,text}]，index 从 1 开始） */
export async function generateNotes({ deck }) {
  const { apiKey, model, baseUrl } = await settings();
  if (!apiKey) throw Error('先配置 API Key（右上角 ⚙）');
  const pages = Array.isArray(deck?.pages) ? deck.pages : [];
  const targets = pages.map((p, i) => ({ p, i })).filter(({ p }) => !String(p?.notes || '').trim());
  if (!targets.length) return { notes: [], note: '每一页都有讲稿了' };
  const brief = (page) => {
    const bits = [];
    for (const [key, value] of Object.entries(page || {})) {
      if (['notes', 'background', 'anim', 'css', 'freeBlocks', 'blockTweaks', 'veil', 'layout', 'id', 'stagger', 'speed', 'minutes'].includes(key)) continue;
      if (typeof value === 'string') bits.push(value);
      else if (Array.isArray(value)) {
        for (const item of value.slice(0, 6)) {
          if (item && typeof item === 'object') bits.push(Object.values(item).filter(v => typeof v === 'string').join(' '));
        }
      }
    }
    return bits.join(' / ').replace(/\s+/g, ' ').slice(0, 220);
  };
  const payload = targets.map(({ p, i }) => ({ index: i + 1, content: brief(p) }));
  const system = '你是老师，正在为课件写上课口述的讲稿。只输出 JSON：{"notes":[{"index":1,"text":"..."}]}，不要 markdown、不要解释。'
    + '每页 2~4 句口语化的话（60~120 字），要包含「先问什么、再讲什么、点哪个易错点」，不要复述页面上的文字；中文。';
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ pages: payload }) }], response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw Error([401, 403].includes(res.status) ? 'API key 无效' : '模型接口请求失败（' + res.status + '）');
  const parsed = JSON.parse((await res.json()).choices[0].message.content);
  const wanted = new Set(targets.map(({ i }) => i + 1));
  const notes = (Array.isArray(parsed?.notes) ? parsed.notes : [])
    .map(n => ({ index: Number(n?.index), text: typeof n?.text === 'string' ? n.text.trim().slice(0, 600) : '' }))
    .filter(n => wanted.has(n.index) && n.text);
  if (!notes.length) throw Error('模型没有返回讲稿，请稍后再试');
  return { notes, note: '已生成 ' + notes.length + ' 页讲稿' };
}

/** 生成一个断网可用的交互演示小组件（高频数学交互优先走内置参数化模板，其余走 AI + 离线校验） */
export async function generateWidget({ instruction, subject, grade, theme, templateId } = {}) {
  const ask = String(instruction || '').trim();
  const explicitTpl = templateId && templateId !== 'auto' && templateId !== 'ai-custom' ? templateId : '';
  if (!ask && !explicitTpl) throw Error('请写一句演示需求或选择一个内置模板');

  if (templateId !== 'ai-custom') {
    const matchedId = explicitTpl || detectWidgetTemplate(ask);
    if (matchedId) {
      const built = buildWidgetFromTemplate(matchedId, ask);
      if (built) {
        const check = checkWidget(built.html);
        if (check.ok) {
          return { html: built.html, bytes: check.bytes, templateId: built.id, note: built.note };
        }
      }
    }
  }

  if (process.env.COURSE_KIT_AI_MOCK === '1') {
    const mockHtml = '<!doctype html><html><body><div style="width:100%;height:100%;display:grid;place-items:center;font:700 28px/1.5 sans-serif;color:var(--ck-text,#1e293b);background:var(--ck-bg,#ffffff)">（模拟）演示块：' + ask.slice(0, 40) + '</div></body></html>';
    return { html: mockHtml, bytes: Buffer.byteLength(mockHtml, 'utf8'), note: '模拟模式' };
  }
  const { apiKey, model, baseUrl } = await settings();
  if (!apiKey) throw Error('先配置 API Key（右上角 ⚙）');
  const meta = [subject ? '学科：' + subject : '', grade ? '学段：' + grade : ''].filter(Boolean).join('、');
  const hint = (meta ? '\n' + meta : '') + (theme ? '\n当前课件主题色：品牌 ' + theme.brand + '、背景 ' + theme.bg + '、文字 ' + theme.text : '');
  const call = async (messages) => {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages }),
    });
    if (!res.ok) throw Error([401, 403].includes(res.status) ? 'API key 无效' : '模型接口请求失败（' + res.status + '）');
    return stripWidgetFence((await res.json()).choices[0].message.content);
  };

  const messages = [{ role: 'system', content: WIDGET_SPEC }, { role: 'user', content: ask + hint }];
  let html = await call(messages);
  let check = checkWidget(html);
  // 第一版不合规（常见是模型顺手加了 CDN 字体/图标）：把违规点回喂，让它重出一次
  if (!check.ok) {
    messages.push({ role: 'assistant', content: html.slice(0, 4000) });
    messages.push({ role: 'user', content: '上面这版不合规：' + check.reasons.join('；') + '。请把所有外链资源删除或改为内联（内联 SVG / base64 / 纯 CSS），重新输出完整 HTML，不要解释。' });
    html = await call(messages);
    check = checkWidget(html);
  }
  // 仍不合规：剥离外链资源（外链样式/脚本/字体/@import/url(http…)），再校验一次
  if (!check.ok) {
    const stripped = html
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
      .replace(/<img\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/[^>]*>/gi, '')
      .replace(/\s(src|href|srcset|poster)\s*=\s*["'](?:https?:)?\/\/[^"']*["']/gi, '')
      .replace(/@import[^;]+;/gi, '')
      .replace(/url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi, 'none')
      .replace(/https?:\/\/[^\s"'<>)\]]+/gi, '');
    const recheck = checkWidget(stripped);
    if (recheck.ok) return { html: stripped, bytes: recheck.bytes, note: '已生成演示块（自动剥离了外链资源）' };
    throw Error('生成的组件不合规：' + check.reasons.join('；'));
  }
  return { html, bytes: check.bytes, note: '已生成演示块' };
}
