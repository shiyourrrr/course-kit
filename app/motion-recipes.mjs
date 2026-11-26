/**
 * 页型动效配方：AI 只填文字，动效由这里按页型定，老师仍可在页面工具里改。
 * 目的是让生成出来的课件"每页有点变化但风格统一"，而不是整份吃同一个默认入场。
 */

const RECIPES = {
  cover: { anim: 'zoom', stagger: 0 },
  objectives: { anim: 'fade-up', stagger: 60 },
  context: { anim: 'fade', stagger: 0 },
  concept: { anim: 'fade-up', stagger: 80 },
  explain: { anim: 'fade-up', stagger: 60 },
  derive: { anim: 'fade', stagger: 0 },
  example: { anim: 'slide-left', stagger: 0 },
  practice: { anim: 'fade-up', stagger: 60 },
  compare: { anim: 'slide-left', stagger: 60 },
  table: { anim: 'fade', stagger: 0 },
  summary: { anim: 'fade', stagger: 60 },
  homework: { anim: 'fade-up', stagger: 0 },
  score: { anim: 'zoom', stagger: 0 },
  wrong: { anim: 'slide-left', stagger: 60 },
  mistake: { anim: 'fade-up', stagger: 60 },
  formula: { anim: 'scale', stagger: 0 },
  variant: { anim: 'fade-up', stagger: 60 },
  exercise: { anim: 'fade-up', stagger: 60 },
  figure: { anim: 'scale', stagger: 0 },
};

// 同样的页型连续出现时换个花样，避免一份课件里"全是上移"
const ROTATION = ['slide-left', 'scale', 'fade', 'flip'];

/**
 * @param {string} layout 页型 id
 * @param {number} index 页序（0 基）
 * @param {number} total 总页数
 * @param {Map<string, number>} seen 已用页型计数（同页型第几次出现）
 */
export function motionRecipe(layout, index, total, seen) {
  const base = RECIPES[layout];
  const nth = seen.get(layout) || 0;
  if (base) {
    if (nth === 0) return base;
    // 第二、三…… 次出现：从轮换表里挑一个**和基准不同**的，节奏保持一致
    const pool = ROTATION.filter((a) => a !== base.anim);
    return { anim: pool[(nth - 1) % pool.length], stagger: base.stagger };
  }
  if (index === 0) return { anim: 'zoom', stagger: 0 };
  if (index === total - 1) return { anim: 'fade', stagger: 0 };
  return { anim: ROTATION[(index - 1) % ROTATION.length], stagger: 60 };
}

/** 给整份生成的课件套配方：已有 anim 的页不动（老师/AI 显式设过），其余按页型分配 */
export function applyMotionRecipes(pages) {
  const seen = new Map();
  const total = pages.length;
  return pages.map((page, index) => {
    const layout = page.layout || 'custom';
    const nth = seen.get(layout) || 0;
    seen.set(layout, nth + 1);
    if (page.anim !== undefined || layout === 'custom') return page;
    const recipe = motionRecipe(layout, index, total, new Map([[layout, nth]]));
    return { ...page, anim: recipe.anim, ...(recipe.stagger ? { stagger: recipe.stagger } : {}) };
  });
}
