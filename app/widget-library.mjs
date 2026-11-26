/**
 * 多源交互演示组件库（轻量目录 + 备课按需拉取缓存 + 本地单文件 HTML 导入）
 *
 * 来源互补：
 * 1. 内置参数化数学引擎（6 个，几 KB，秒出可调参数）
 * 2. PhET 官方中文交互实验（24 个中学高频理化生数实验，联网按需拉取单文件离线 HTML 并本地缓存）
 * 3. 本地导入任意开源单文件 .html（如 GeoGebra / PhET / Falstad / oPhysics 导出文件）
 * 4. 外部专业平台精选直达（GeoGebra / Desmos / Falstad / oPhysics）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { renameRetry } from '../src/fs-retry.mjs';

export const BUILTIN_WIDGET_ITEMS = [
  { id: 'quadratic-explorer', source: 'builtin', subject: '数学', title: '二次函数参数滑块', desc: '拖动 a、b、c 实时看开口、顶点与对称轴变化（可自定义参数）', tags: ['二次函数', '抛物线', '函数'] },
  { id: 'linear-explorer', source: 'builtin', subject: '数学', title: '一次函数斜率与截距', desc: '拖动 k、b 直观演示象限穿越与增减性', tags: ['一次函数', '斜率', '直线'] },
  { id: 'trig-explorer', source: 'builtin', subject: '数学', title: '三角函数图像变换', desc: '调节振幅 A、频率 ω、相位 φ 动态演示正弦波', tags: ['三角函数', '正弦', '波形'] },
  { id: 'geometry-glider', source: 'builtin', subject: '数学', title: '几何动点与面积探究', desc: '拖动动点 P 实时计算三角形面积与线段变化', tags: ['几何', '动点', '面积', '三角形'] },
  { id: 'pythagoras-visual', source: 'builtin', subject: '数学', title: '勾股定理面积拼图', desc: '改变两直角边 a、b 直观验证 a² + b² = c²', tags: ['勾股定理', '直角三角形', '面积法'] },
  { id: 'step-derivation', source: 'builtin', subject: '数学', title: '分步公式推导器', desc: '点击逐步展开公式变形，适合课堂分步讲解', tags: ['推导', '公式', '方程', '因式分解'] },
];

export const PHET_CATALOG = [
  // 物理（11）
  { slug: 'circuit-construction-kit-dc', subject: '物理', title: '电路搭建实验：直流电', desc: '自由拼接电池、灯泡、电阻、开关与电表，动态看电流与电压', tags: ['电路', '串联', '并联', '电流', '电学'] },
  { slug: 'geometric-optics-basics', subject: '物理', title: '几何光学：凸透镜与成像', desc: '拖动蜡烛、焦距与屏幕，实时演示实像/虚像与光路图', tags: ['光学', '凸透镜', '成像', '焦距'] },
  { slug: 'forces-and-motion-basics', subject: '物理', title: '力与运动基础', desc: '拔河合力、摩擦力与加速度直观演示牛顿定律', tags: ['力学', '牛顿', '摩擦力', '合力'] },
  { slug: 'projectile-motion', subject: '物理', title: '抛体运动仿真', desc: '调节初速度、仰角与空气阻力，画出抛物线轨迹并测射程', tags: ['平抛', '斜抛', '运动', '重力'] },
  { slug: 'energy-skate-park-basics', subject: '物理', title: '能量滑板公园：机械能守恒', desc: '动态柱状图实时展示动能、重力势能与热能转化', tags: ['机械能', '动能', '势能', '守恒'] },
  { slug: 'faradays-law', subject: '物理', title: '法拉第电磁感应定律', desc: '拖动磁铁穿过线圈，观察电流表偏转与灯泡亮度', tags: ['电磁感应', '磁场', '线圈', '法拉第'] },
  { slug: 'wave-on-a-string', subject: '物理', title: '绳波与机械波', desc: '调节振幅、频率与阻尼，慢动作演示横波传播与反射', tags: ['机械波', '频率', '振幅', '波长'] },
  { slug: 'gravity-and-orbits', subject: '物理', title: '万有引力与天体轨道', desc: '调节恒星/行星质量演示公转轨道与引力矢量', tags: ['万有引力', '天体', '轨道', '航天'] },
  { slug: 'gas-properties', subject: '物理', title: '气体性质与压强', desc: '打气筒注入分子，演示温度、体积与压强的微观关系', tags: ['压强', '热学', '气体', '分子'] },
  { slug: 'ohms-law', subject: '物理', title: '欧姆定律直观演示', desc: '拖动电压 U 与电阻 R，实时观察公式缩放与电流变化', tags: ['欧姆定律', '电压', '电阻', '电流'] },
  { slug: 'friction', subject: '物理', title: '摩擦生热微观演示', desc: '摩擦两本书观察微观原子振动加剧与温度上升', tags: ['摩擦', '内能', '热学', '微观'] },
  // 化学（6）
  { slug: 'build-an-atom', subject: '化学', title: '构建原子与元素周期表', desc: '拖入质子、中子、电子，实时判断元素、电荷与质量数', tags: ['原子', '质子', '电子', '元素'] },
  { slug: 'molecule-shapes', subject: '化学', title: '分子三维立体构型', desc: '旋转 3D 分子模型，查看键角与孤对电子排斥', tags: ['分子', '立体构型', '化学键', '3D'] },
  { slug: 'balancing-chemical-equations', subject: '化学', title: '配平化学方程式', desc: '天平与分子图直观演示质量守恒与系数配平', tags: ['配平', '化学方程式', '质量守恒'] },
  { slug: 'ph-scale', subject: '化学', title: '酸碱度 pH 标尺', desc: '测试常见液体酸碱性，加水稀释观察 H+ / OH- 浓度变化', tags: ['酸碱', 'pH', '中和', '溶液'] },
  { slug: 'states-of-matter-basics', subject: '化学', title: '物质三态与相变', desc: '加热或冷却粒子，观察固态/液态/气态微观排布', tags: ['三态', '物态变化', '分子', '相变'] },
  { slug: 'concentration', subject: '化学', title: '溶液浓度与溶解饱和', desc: '撒溶质、加水、蒸发，实时测定溶液摩尔浓度', tags: ['溶液', '浓度', '饱和', '溶解'] },
  // 数学（5）
  { slug: 'graphing-quadratics', subject: '数学', title: 'PhET 二次函数深度探究', desc: '标准式、顶点式、焦点与准线全交互坐标系', tags: ['二次函数', '顶点式', '抛物线'] },
  { slug: 'graphing-slope-intercept', subject: '数学', title: 'PhET 斜率与截距探究', desc: '拖动直线上任意两点实时算斜率、保存对比多条直线', tags: ['一次函数', '斜率', '截距', '坐标系'] },
  { slug: 'area-model-algebra', subject: '数学', title: '面积模型与整式乘法', desc: '用矩形分割面积直观理解分配律、完全平方与因式分解', tags: ['整式乘法', '因式分解', '面积模型', '完全平方'] },
  { slug: 'vector-addition', subject: '数学', title: '平面向量加法与分解', desc: '拖动向量箭头实时看平行四边形法则与坐标分量', tags: ['向量', '平行四边形', '三角分解'] },
  { slug: 'plinko-probability', subject: '数学', title: '高尔顿板与概率统计', desc: '下落小球实时生成频数直方图，直观理解二项/正态分布', tags: ['概率', '统计', '直方图', '分布'] },
  // 生物（2）
  { slug: 'natural-selection', subject: '生物', title: '自然选择与生物进化', desc: '设置毛色突变与天敌环境，多代演化折线图直观呈现', tags: ['自然选择', '进化', '遗传', '种群'] },
  { slug: 'gene-expression-essentials', subject: '生物', title: '基因表达：转录与翻译', desc: '拖动 RNA 聚合酶与核糖体，动态演示蛋白质合成全过程', tags: ['基因', '转录', '翻译', 'DNA'] },
];

export const EXTERNAL_PORTALS = [
  { name: 'GeoGebra 中文资源库', subject: '数学', url: 'https://www.geogebra.org/materials', tip: '初高中几何、立体几何、圆锥曲线现成互动图（可导出离线 HTML 再导入）' },
  { name: 'Desmos 图形计算器', subject: '数学', url: 'https://www.desmos.com/calculator?lang=zh-CN', tip: '函数与 3D 曲面交互演示' },
  { name: 'Falstad 电路仿真', subject: '物理', url: 'https://www.falstad.com/circuit/circuitjs.html', tip: '动态电流与交直流电路实验' },
  { name: 'oPhysics 物理仿真', subject: '物理', url: 'https://ophysics.com/', tip: '100+ 极简 HTML5 力学/光学/波物理交互实验' },
  { name: 'PhET 中文官网全部实验', subject: '综合', url: 'https://phet.colorado.edu/zh_CN/simulations/browse', tip: '160+ 全学科实验，可下载单文件 .html 直接导入本库' },
];

const MAX_EXTERNAL_HTML = 12 * 1024 * 1024;
const VALID_REF = /^[\w-]{2,90}$/;
const indexLocks = new Map();

/** 按演示库目录串行化索引事务，避免并发导入/删除互相覆盖 local-index.json */
function withIndexLock(widgetsDir, fn) {
  const key = path.resolve(widgetsDir);
  const prev = indexLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = () => { if (indexLocks.get(key) === next) indexLocks.delete(key); };
  next.then(cleanup, cleanup);
  indexLocks.set(key, next);
  return next;
}

async function readLocalIndex(widgetsDir) {
  try {
    const raw = await fs.readFile(path.join(widgetsDir, 'local-index.json'), 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw Error('演示库索引格式损坏');
    return list;
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw Error('读取演示库索引失败：' + err.message);
  }
}

async function writeLocalIndex(widgetsDir, list) {
  await fs.mkdir(widgetsDir, { recursive: true });
  const tmp = path.join(widgetsDir, '.idx-' + crypto.randomUUID());
  try {
    await fs.writeFile(tmp, JSON.stringify(list, null, 2));
    await renameRetry(tmp, path.join(widgetsDir, 'local-index.json'));
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function isPrivateOrReservedHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes(':')) return true; // IPv6（含 ::1、fe80:: 等）
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

/**
 * 规范化外部互动链接：自动把 GeoGebra / Desmos 常见分享链接转为无多余顶栏的纯净嵌入地址
 */
export function normalizeEmbedUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch { throw Error('请输入有效的 https:// 网址'); }
  if (u.protocol !== 'https:') throw Error('外部互动链接必须使用 https://');
  if (u.username || u.password) throw Error('外部互动链接不允许包含用户名或密码');
  const host = u.hostname.toLowerCase();
  if (isPrivateOrReservedHost(host)) throw Error('不支持内网或本机地址');

  // GeoGebra: /m/<id>, /classic/<id>, /calculator/<id>, /geometry/<id>, /3d/<id>
  if (hostMatches(host, 'geogebra.org')) {
    const m = /^\/(?:m|classic|calculator|geometry|graphing|3d)\/([a-zA-Z0-9]+)/.exec(u.pathname);
    if (m) {
      return {
        embedUrl: `https://www.geogebra.org/material/iframe/id/${m[1]}/width/1080/height/580/border/888888/sfsb/true/smb/false/stb/false/stbh/false/ai/false/asb/false/sri/true/rc/false/ld/false/sdz/true/ctl/false`,
        provider: 'GeoGebra',
      };
    }
    return { embedUrl: u.href, provider: 'GeoGebra' };
  }

  // Desmos: /calculator/<id>, /geometry/<id>, /3d/<id>
  if (hostMatches(host, 'desmos.com')) {
    if (!u.searchParams.has('embed')) u.searchParams.set('embed', '');
    return { embedUrl: u.href.replace(/embed=$/, 'embed'), provider: 'Desmos' };
  }

  if (hostMatches(host, 'falstad.com')) return { embedUrl: u.href, provider: 'Falstad' };
  if (hostMatches(host, 'ophysics.com')) return { embedUrl: u.href, provider: 'oPhysics' };
  if (hostMatches(host, 'phet.colorado.edu')) return { embedUrl: u.href, provider: 'PhET' };
  return { embedUrl: u.href, provider: host };
}

/** 保存外部互动链接到本地演示库（联网嵌入，无需下载 .html） */
export async function saveEmbedWidget(widgetsDir, { title, subject = '数学', url } = {}) {
  const { embedUrl, provider } = normalizeEmbedUrl(url);
  const cleanTitle = String(title || `${provider} 互动演示`).trim().slice(0, 60);
  const widgetRef = 'embed-' + crypto.randomUUID().slice(0, 8);
  return withIndexLock(widgetsDir, async () => {
    const list = await readLocalIndex(widgetsDir);
    const item = {
      id: widgetRef,
      widgetRef,
      source: 'embed',
      provider,
      subject: String(subject || '数学').trim(),
      title: cleanTitle,
      embedUrl,
      originalUrl: String(url).trim(),
      desc: `${provider} 在线互动嵌入（需教室联网）`,
      addedAt: new Date().toISOString(),
    };
    list.unshift(item);
    await writeLocalIndex(widgetsDir, list);
    return item;
  });
}

/** 列出全部演示库（内置 + PhET 目录含缓存状态 + 本地导入/外链嵌入 + 外部平台直达） */
export async function listWidgetLibrary(widgetsDir) {
  const existing = new Set(await fs.readdir(widgetsDir).catch(() => []));
  const phet = PHET_CATALOG.map((item) => {
    const widgetRef = 'phet-' + item.slug;
    return {
      ...item,
      id: widgetRef,
      widgetRef,
      source: 'phet',
      cached: existing.has(widgetRef + '.html'),
    };
  });
  const local = (await readLocalIndex(widgetsDir)).filter((item) => item.source === 'embed' || existing.has(item.widgetRef + '.html'));
  return {
    builtin: BUILTIN_WIDGET_ITEMS,
    phet,
    local,
    portals: EXTERNAL_PORTALS,
  };
}

async function readTextWithLimit(res, maxBytes) {
  const lenHeader = Number(res.headers?.get?.('content-length') || 0);
  if (Number.isFinite(lenHeader) && lenHeader > maxBytes) {
    throw Error('下载的 PhET 文件超过体积上限');
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw Error('下载的 PhET 文件超过体积上限');
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      total += buf.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw Error('下载的 PhET 文件超过体积上限');
      }
      chunks.push(buf);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

/** 按需联网拉取 PhET 官方中文单文件 HTML 并缓存到本地 app-data/widgets/ */
export async function fetchPhetWidget(widgetsDir, slug, { fetchImpl = fetch, maxBytes = MAX_EXTERNAL_HTML } = {}) {
  const cleanSlug = String(slug || '').replace(/^phet-/, '');
  const entry = PHET_CATALOG.find((x) => x.slug === cleanSlug);
  if (!entry) throw Error('未在精选目录中找到该 PhET 实验');

  const widgetRef = 'phet-' + entry.slug;
  const target = path.join(widgetsDir, widgetRef + '.html');
  const exists = await fs.stat(target).catch(() => null);
  if (exists && exists.size > 1024) {
    return { widgetRef, title: entry.title, subject: entry.subject, cached: true, bytes: exists.size };
  }

  const url = `https://phet.colorado.edu/sims/html/${entry.slug}/latest/${entry.slug}_zh_CN.html`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw Error(`下载 PhET 实验失败（HTTP ${res.status}），请检查网络连接或稍后重试`);
  const html = await readTextWithLimit(res, maxBytes);
  if (!/<(html|body)[\s>]/i.test(html)) {
    throw Error('下载的 PhET 文件格式异常');
  }

  await fs.mkdir(widgetsDir, { recursive: true });
  const tmp = path.join(widgetsDir, '.phet-' + crypto.randomUUID());
  try {
    await fs.writeFile(tmp, html, 'utf8');
    await renameRetry(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return { widgetRef, title: entry.title, subject: entry.subject, cached: true, bytes: Buffer.byteLength(html, 'utf8') };
}

/** 导入本地单文件离线 HTML 演示（支持 PhET / GeoGebra / Falstad / 任意自包含 HTML） */
export async function importLocalWidget(widgetsDir, { title, subject = '综合', filename = '', html = '' } = {}) {
  const text = String(html || '');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (!bytes || !/<(html|body|svg|canvas)[\s>]/i.test(text)) throw Error('请上传有效的 HTML 交互演示文件');
  if (bytes > MAX_EXTERNAL_HTML) throw Error('演示文件超过 12 MB 上限');

  const cleanTitle = String(title || filename.replace(/\.html?$/i, '') || '自定义演示').trim().slice(0, 60);
  const widgetRef = 'local-' + crypto.randomUUID().slice(0, 8);
  const finalHtml = path.join(widgetsDir, widgetRef + '.html');
  return withIndexLock(widgetsDir, async () => {
    await fs.mkdir(widgetsDir, { recursive: true });
    const tmp = path.join(widgetsDir, '.imp-' + crypto.randomUUID());
    let fileCommitted = false;
    try {
      await fs.writeFile(tmp, text, 'utf8');
      await renameRetry(tmp, finalHtml);
      fileCommitted = true;
      const list = await readLocalIndex(widgetsDir);
      const item = {
        id: widgetRef,
        widgetRef,
        source: 'local',
        subject: String(subject || '综合').trim(),
        title: cleanTitle,
        desc: filename ? `本地导入 · ${filename}` : '本地导入的离线交互演示',
        bytes,
        addedAt: new Date().toISOString(),
      };
      list.unshift(item);
      await writeLocalIndex(widgetsDir, list);
      return item;
    } catch (err) {
      if (fileCommitted) await fs.rm(finalHtml, { force: true }).catch(() => {});
      throw err;
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  });
}

/** 删除本地导入或外链嵌入的演示组件 */
export async function deleteLocalWidget(widgetsDir, widgetRef) {
  if (!VALID_REF.test(String(widgetRef || '')) || !/^(?:local|embed)-/.test(String(widgetRef))) {
    throw Error('只能删除本地导入或外链嵌入的演示组件');
  }
  return withIndexLock(widgetsDir, async () => {
    const list = (await readLocalIndex(widgetsDir)).filter((x) => x.widgetRef !== widgetRef);
    await writeLocalIndex(widgetsDir, list);
    await fs.rm(path.join(widgetsDir, widgetRef + '.html'), { force: true });
    return { ok: true };
  });
}
