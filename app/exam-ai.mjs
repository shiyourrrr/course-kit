// AI 出卷与课后作业题量/自由度控制模块
// 借鉴：liuyunc/exam_generator（溯源出题与题型配额）、csv610/mcq_generator（题量/难度硬约束）、
// moodle-local_hlai_quizgen（生成→人工审核勾选闭环）、TestPaperPro（分层难度与开放度控制）

import { settings } from './ai.mjs';

export const FREEDOM_PRESETS = {
  strict: {
    id: 'strict',
    label: '严格紧扣（不超纲 · 原题改数/紧贴教材）',
    temperature: 0.2,
    prompt: '【自由度：严格紧扣】只围绕所给教材/参考卷知识点命题，允许改换数字或微调问法，严禁超纲、严禁引入未教过的公式或概念。',
  },
  balanced: {
    id: 'balanced',
    label: '标准变式（推荐 · 适度情境与变式）',
    temperature: 0.5,
    prompt: '【自由度：标准变式】紧扣本课核心知识点，允许在同年级范围内做常规变式、正反辨析与常见易错点考查。',
  },
  creative: {
    id: 'creative',
    label: '自由拓展（生活情境 · 综合探究与开放题）',
    temperature: 0.8,
    prompt: '【自由度：自由拓展】鼓励结合真实生活情境、跨小节综合应用、探究性设问与适度开放题，同时确保答案严谨可验证。',
  },
};

export const DIFFICULTY_PRESETS = {
  basic: {
    id: 'basic',
    label: '基础巩固为主（约 80% 基础 + 20% 提升）',
    prompt: '【难度侧重：基础巩固】约 80% 为直接套用概念/公式的基础题，20% 为轻微变形题，保证绝大多数学生能顺利上手。',
  },
  tiered: {
    id: 'tiered',
    label: '分层递进（基础 → 提高 → 拓展）',
    prompt: '【难度侧重：分层递进】按基础（约 50%）→ 提高（约 35%）→ 拓展（约 15%）由浅入深排布，坡度平滑。',
  },
  challenge: {
    id: 'challenge',
    label: '提高与压轴为主（约 40% 中档 + 60% 综合）',
    prompt: '【难度侧重：提高与压轴】减少机械计算，侧重多步推理、分类讨论、易错陷阱与综合压轴题。',
  },
};

export function resolveFreedom(id) {
  return FREEDOM_PRESETS[id] || FREEDOM_PRESETS.balanced;
}

export function resolveDifficulty(id) {
  return DIFFICULTY_PRESETS[id] || DIFFICULTY_PRESETS.tiered;
}

export function normalizeHomeworkCount(rawCount) {
  if (rawCount === undefined || rawCount === null || rawCount === '') return 5;
  const n = Number(rawCount);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw Error('课后作业题量必须是 1~12 的整数');
  }
  return n;
}

/** 按目标题量（1~12 题）动态构建课后作业页序骨架，默认 5 题保持原有 5 页结构，超过单页 8 题容量自动拆成 2 页作业清单 */
export function buildHomeworkSkeleton(rawCount) {
  const count = normalizeHomeworkCount(rawCount);
  if (count <= 2) return ['cover', 'exercise', 'homework'];
  if (count <= 4) return ['cover', 'exercise', 'variant', 'homework'];
  if (count === 5) return ['cover', 'exercise', 'exercise', 'variant', 'homework'];
  if (count <= 7) return ['cover', 'exercise', 'exercise', 'variant', 'variant', 'homework'];
  if (count <= 8) return ['cover', 'exercise', 'exercise', 'exercise', 'variant', 'variant', 'homework'];
  return ['cover', 'exercise', 'exercise', 'exercise', 'variant', 'variant', 'homework', 'homework'];
}

export function homeworkGuidance({ questionCount = 5, freedom = 'balanced', difficulty = 'tiered' } = {}) {
  const count = normalizeHomeworkCount(questionCount);
  const f = resolveFreedom(freedom);
  const d = resolveDifficulty(difficulty);
  return {
    count,
    temperature: f.temperature,
    prompt: ` 本次课后作业目标总题量为严格 ${count} 题（请合理分配到各练习页与作业清单页中；若包含多个 homework 页，请平均分摊 tasks 条目，确保全部 homework 页的 tasks 总数严格等于 ${count} 题）。${f.prompt} ${d.prompt}`,
  };
}

const EXAM_TYPE_META = [
  { key: 'single', label: '单选', defaultCount: 4 },
  { key: 'multi', label: '多选', defaultCount: 0 },
  { key: 'judge', label: '判断', defaultCount: 2 },
  { key: 'blank', label: '填空', defaultCount: 3 },
  { key: 'essay', label: '解答', defaultCount: 2 },
];

export function normalizeExamCounts(raw = {}) {
  const out = {};
  let total = 0;
  for (const { key, label } of EXAM_TYPE_META) {
    const v = raw?.[key];
    if (v === undefined || v === null || v === '') {
      out[key] = 0;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      throw Error(`${label}题量必须是非负整数`);
    }
    if (n > 15) {
      throw Error(`${label}题单次最多 15 题`);
    }
    out[key] = n;
    total += n;
  }
  if (total < 1) throw Error('请至少设置 1 道题');
  if (total > 30) throw Error('单次 AI 出卷最多 30 题，请减少题量后重试');
  return { counts: out, total };
}

function parseJsonStrict(raw) {
  let text = String(raw || '').trim();
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const first = text.search(/[\[{]/);
  if (first > 0) text = text.slice(first);
  return JSON.parse(text);
}

/** 将结构化题目数组格式化为 tools/question-parse.mjs 100% 兼容的标准 Markdown */
export function formatQuestionsToMarkdown(questions = []) {
  const letters = 'ABCDEFGH';
  const blocks = [];
  questions.forEach((q, idx) => {
    const no = idx + 1;
    const type = ['单选', '多选', '判断', '填空', '解答'].includes(q.type) ? q.type : '解答';
    let stem = String(q.stem || '').replace(/\r?\n+/g, ' ').trim();
    if (type === '填空' && !stem.includes('___')) stem += '（____）';
    const lines = [`${no}. 【${type}】${stem}`];
    if ((type === '单选' || type === '多选') && Array.isArray(q.options) && q.options.length >= 2) {
      q.options.slice(0, 8).forEach((opt, i) => {
        const cleaned = String(opt || '').replace(/^[A-H][.、．]\s*/i, '').trim();
        lines.push(`${letters[i]}. ${cleaned}`);
      });
    }
    const ans = String(q.answer || '').replace(/\r?\n+/g, ' ').trim();
    if (ans) lines.push(`答案：${ans}`);
    const exp = String(q.explain || '').replace(/\r?\n+/g, ' ').trim();
    if (exp) lines.push(`解析：${exp}`);
    blocks.push(lines.join('\n'));
  });
  return blocks.join('\n\n');
}

function buildMockQuestions(title, counts) {
  const list = [];
  for (let i = 0; i < counts.single; i++) {
    list.push({ type: '单选', stem: `关于「${title}」的基础概念，下列说法正确的是（第 ${i + 1} 题）`, options: ['符合核心定义', '条件缺失', '符号相反', '与结论无关'], answer: 'A', explain: '依据核心定义直接判断。' });
  }
  for (let i = 0; i < counts.multi; i++) {
    list.push({ type: '多选', stem: `关于「${title}」的性质，以下说法正确的有（第 ${i + 1} 题）`, options: ['性质一成立', '性质二成立', '忽略限定条件', '反向推导必成立'], answer: 'AB', explain: '前两项均满足定理条件。' });
  }
  for (let i = 0; i < counts.judge; i++) {
    list.push({ type: '判断', stem: `在「${title}」中，满足给定前提条件时核心结论一定成立（第 ${i + 1} 题）。`, answer: '正确', explain: '由基本定理直接得出。' });
  }
  for (let i = 0; i < counts.blank; i++) {
    list.push({ type: '填空', stem: `在「${title}」相关计算中，当参数取标准值时结果为 ____（第 ${i + 1} 题）。`, answer: String(i + 2), explain: '代入公式计算可得。' });
  }
  for (let i = 0; i < counts.essay; i++) {
    list.push({ type: '解答', stem: `结合「${title}」的核心方法，写出第 ${i + 1} 题的完整推导与求解步骤。`, answer: '先列关系式，再化简求解。', explain: '注意检验限定条件是否满足。' });
  }
  return list;
}

/** AI 按题型配额、自由度与难度生成试卷题目 */
export async function generateExamQuestions(input, materialSuffix = '') {
  const { apiKey, model, baseUrl } = await settings();
  if (!apiKey && process.env.COURSE_KIT_AI_MOCK !== '1') {
    throw Error('先配置 API Key（右上角 ⚙），再使用 AI 出卷');
  }
  const title = String(input?.title || '').trim();
  if (!title) throw Error('请填写试卷课题或范围');
  const grade = String(input?.grade || '七年级').trim();
  const brief = String(input?.brief || '').trim();
  const freedom = resolveFreedom(input?.freedom);
  const difficulty = resolveDifficulty(input?.difficulty);
  const { counts, total } = normalizeExamCounts(input?.counts);

  if (process.env.COURSE_KIT_AI_MOCK === '1') {
    const questions = buildMockQuestions(title, counts);
    return {
      markdown: formatQuestionsToMarkdown(questions),
      questions,
      counts,
      total: questions.length,
      freedom: freedom.id,
      difficulty: difficulty.id,
    };
  }

  const quotaDesc = EXAM_TYPE_META
    .filter(({ key }) => counts[key] > 0)
    .map(({ key, label }) => `${label}题 ${counts[key]} 道`)
    .join('、');

  const system = [
    '你是资深中小学命题教师。请严格按要求的题型数量、自由度与难度出卷。',
    '只输出纯 JSON：{"questions":[{"type":"单选|多选|判断|填空|解答","stem":"题干","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":"答案","explain":"解析"}]}，不要 markdown 代码块或额外解释。',
    `题量铁律：必须严格生成共 ${total} 道题，题型分布严格为：${quotaDesc}。`,
    '格式规则：1）单选/多选必须给 4 个不含"A."前缀的选项内容，answer 只写大写字母（如 "B" 或 "AC"）；2）判断题 answer 写"正确"或"错误"；3）填空题题干中必须包含 "____"；4）数学公式用 $...$；5）每题必须给出简洁清晰的 explain 解析。',
    freedom.prompt,
    difficulty.prompt,
  ].join('\n');

  const user = JSON.stringify({ title, grade, brief, counts, total }) + (materialSuffix || '');

  let parsed = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const signal = AbortSignal.timeout(90000);
    try {
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: freedom.temperature,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if ([401, 403].includes(res.status)) {
        const err = Error('API key 无效');
        err.noRetry = true;
        throw err;
      }
      if (!res.ok) throw Error('模型接口请求失败（' + res.status + '）');
      parsed = parseJsonStrict((await res.json()).choices?.[0]?.message?.content);
      break;
    } catch (e) {
      if (e?.noRetry) throw e;
      if (attempt === 1) {
        if (signal.aborted) throw Error('AI 出卷超过 90 秒，请减少题量后重试');
        if (e.message === 'fetch failed') throw Error('网络失败，请检查接口地址和连接');
        if (e instanceof SyntaxError) throw Error('模型返回题目格式不对，请重试');
        throw e;
      }
    }
  }

  const rawList = Array.isArray(parsed?.questions) ? parsed.questions : [];
  if (!rawList.length) throw Error('模型未返回有效题目，请重试');

  // 按配额硬校验各题型数量，拒绝全错题型绕过配额，并反馈缺口
  const buckets = { 单选: [], 多选: [], 判断: [], 填空: [], 解答: [] };
  const labelByKey = { single: '单选', multi: '多选', judge: '判断', blank: '填空', essay: '解答' };
  const limitByLabel = Object.fromEntries(Object.entries(labelByKey).map(([k, l]) => [l, counts[k]]));
  for (const q of rawList) {
    if (!q || typeof q !== 'object' || !String(q.stem || '').trim()) continue;
    const t = ['单选', '多选', '判断', '填空', '解答'].includes(q.type) ? q.type : '';
    if (!t) continue;
    if (buckets[t].length < (limitByLabel[t] || 0)) buckets[t].push(q);
  }
  const ordered = ['单选', '多选', '判断', '填空', '解答'].flatMap((l) => buckets[l]);
  if (!ordered.length) {
    throw Error('模型未按要求的题型返回有效题目，请重试或调整自由度');
  }
  const missing = [];
  for (const l of ['单选', '多选', '判断', '填空', '解答']) {
    const diff = (limitByLabel[l] || 0) - buckets[l].length;
    if (diff > 0) missing.push(`${l}缺 ${diff} 题`);
  }
  return {
    markdown: formatQuestionsToMarkdown(ordered),
    questions: ordered,
    counts,
    total: ordered.length,
    requestedTotal: total,
    ...(missing.length ? { warning: `实际生成 ${ordered.length}/${total} 题（${missing.join('、')}）` } : {}),
    freedom: freedom.id,
    difficulty: difficulty.id,
  };
}
