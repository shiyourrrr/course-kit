/**
 * 内置参数化数学/课堂交互演示块模板库
 *
 * 设计借鉴：
 * - JSXGraph（MIT/LGPL 双许可，仅借鉴其「坐标画板 + 几何动点 Glider + 实时轨迹」教学交互模型，零外部代码）
 * - Mafs（MIT，借鉴其声明式直角网格 + 参数滑块 + 特征点实时标注布局）
 * - CourseForge（MIT，统一使用 --ck-brand / --ck-bg / --ck-surface / --ck-text / --ck-border 主题令牌）
 *
 * 所有产出均为 100% 离线自包含完整 HTML 文档（无任何外链，体积 < 12KB，通过 checkWidget 校验）。
 */

export const WIDGET_TEMPLATES = [
  {
    id: 'quadratic-explorer',
    name: '二次函数参数滑块',
    subject: '数学',
    summary: '实时调节 a / b / c，联动展示抛物线开口、对称轴、顶点坐标与判别式 Δ',
    samplePrompt: '二次函数 y = ax^2 + bx + c 参数滑块探究（默认 a=1, b=-2, c=-3）',
  },
  {
    id: 'linear-explorer',
    name: '一次函数斜率截距',
    subject: '数学',
    summary: '实时调节斜率 k 与截距 b，联动展示直线升降、坐标轴交点与经过象限',
    samplePrompt: '一次函数 y = kx + b 图像与性质滑块探究（默认 k=1.5, b=1）',
  },
  {
    id: 'trig-explorer',
    name: '三角函数图像变换',
    subject: '数学',
    summary: '调节振幅 A、角频率 ω、初相 φ，对比标准 sin x 虚线与周期变化',
    samplePrompt: '三角函数 y = A sin(ωx + φ) 振幅周期相位变换演示',
  },
  {
    id: 'geometry-glider',
    name: '几何动点与面积探究',
    subject: '数学',
    summary: '动点 P 沿折线/边运动（支持拖动滑块或自动播放），左侧几何画板联动右侧面积函数曲线',
    samplePrompt: '矩形动点 P 运动与 △ABP 面积函数动点探究',
  },
  {
    id: 'pythagoras-visual',
    name: '勾股定理面积拼图',
    subject: '数学',
    summary: '调节直角边 a 与 b，直观对比 a² + b² = c² 三块正方形面积与赵爽弦图',
    samplePrompt: '勾股定理直角边 a、b 变化与三正方形面积关系探究',
  },
  {
    id: 'step-derivation',
    name: '分步公式推导器',
    subject: '通用',
    summary: '课堂一步一讲公式变形播放器，高亮当前变换项并同步展示变形依据',
    samplePrompt: '配方法推导二次函数顶点式的分步交互卡片',
  },
];

const COMMON_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;font-family:"Microsoft YaHei",system-ui,sans-serif;background:var(--ck-bg,#ffffff);color:var(--ck-text,#1e293b)}
.wrap{width:100%;height:100%;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(210px,1fr);gap:14px;padding:14px;background:var(--ck-bg,#ffffff)}
.board{background:var(--ck-surface,#f8fafc);border:1.5px solid var(--ck-border,#cbd5e1);border-radius:12px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;min-height:0}
.board svg{width:100%;height:100%;display:block}
.side{display:flex;flex-direction:column;justify-content:space-between;gap:10px;background:var(--ck-surface,#f8fafc);border:1.5px solid var(--ck-border,#cbd5e1);border-radius:12px;padding:14px;min-height:0;overflow:auto}
.head{font-size:clamp(15px,2.2vmin,20px);font-weight:700;color:var(--ck-brand,#2563eb);line-height:1.3}
.eq{font-size:clamp(16px,2.5vmin,22px);font-weight:700;padding:8px 10px;border-radius:8px;background:var(--ck-bg,#ffffff);border:1px solid var(--ck-border,#cbd5e1);font-variant-numeric:tabular-nums;text-align:center}
.ctrl{display:flex;flex-direction:column;gap:8px}
.row{display:grid;grid-template-columns:42px 1fr 48px;align-items:center;gap:8px;font-size:clamp(13px,1.9vmin,16px);font-weight:600}
.row span:last-child{text-align:right;font-variant-numeric:tabular-nums;color:var(--ck-brand,#2563eb)}
input[type=range]{width:100%;accent-color:var(--ck-brand,#2563eb);cursor:pointer}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:clamp(12px,1.7vmin,15px)}
.stat{background:var(--ck-bg,#ffffff);border:1px solid var(--ck-border,#cbd5e1);border-radius:8px;padding:6px 8px}
.stat small{display:block;color:var(--ck-muted,#64748b);font-size:.86em}
.stat b{font-variant-numeric:tabular-nums;color:var(--ck-text,#1e293b)}
.btns{display:flex;gap:6px;flex-wrap:wrap}
button{font:inherit;font-size:clamp(12px,1.7vmin,14px);font-weight:600;padding:5px 10px;border-radius:7px;border:1px solid var(--ck-border,#cbd5e1);background:var(--ck-bg,#ffffff);color:var(--ck-text,#1e293b);cursor:pointer;transition:transform 180ms cubic-bezier(.2,.8,.2,1),background 180ms cubic-bezier(.2,.8,.2,1)}
button:hover{border-color:var(--ck-brand,#2563eb);color:var(--ck-brand,#2563eb)}
button.pri{background:var(--ck-brand,#2563eb);border-color:var(--ck-brand,#2563eb);color:#fff}
@media (max-width:520px){.wrap{grid-template-columns:1fr;grid-template-rows:1.2fr 1fr}}
@media print{.btns,input[type=range]{display:none!important}}
@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`.trim();

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function parseNum(instruction, name, fallback) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
  const m = re.exec(String(instruction || ''));
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : fallback;
}

function wrapDoc(title, bodyHtml, scriptCode, extraCss = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>${COMMON_CSS}${extraCss}</style></head><body>${bodyHtml}<script>(function(){${scriptCode}})();</script></body></html>`;
}

function buildQuadratic(instruction = '') {
  const a0 = Math.max(-3, Math.min(3, parseNum(instruction, 'a', 1))) || 1;
  const b0 = Math.max(-6, Math.min(6, parseNum(instruction, 'b', -2)));
  const c0 = Math.max(-6, Math.min(6, parseNum(instruction, 'c', -3)));
  const body = `
<div class="wrap">
  <div class="board">
    <svg viewBox="0 0 440 360" aria-label="二次函数坐标图像">
      <g id="grid" stroke="var(--ck-border,#cbd5e1)" stroke-width="1" opacity="0.65"></g>
      <line x1="20" y1="180" x2="420" y2="180" stroke="var(--ck-muted,#64748b)" stroke-width="1.8"/>
      <line x1="220" y1="20" x2="220" y2="340" stroke="var(--ck-muted,#64748b)" stroke-width="1.8"/>
      <text x="410" y="172" font-size="13" fill="var(--ck-muted,#64748b)">x</text>
      <text x="228" y="32" font-size="13" fill="var(--ck-muted,#64748b)">y</text>
      <line id="axisSym" x1="220" y1="20" x2="220" y2="340" stroke="var(--ck-brand,#2563eb)" stroke-width="1.6" stroke-dasharray="6 5" opacity="0.8"/>
      <path id="curve" fill="none" stroke="var(--ck-brand,#2563eb)" stroke-width="3.2" stroke-linecap="round"/>
      <g id="roots"></g>
      <circle id="vtx" cx="220" cy="180" r="5.5" fill="var(--ck-brand,#2563eb)" stroke="var(--ck-bg,#fff)" stroke-width="2"/>
      <text id="vtxLabel" x="228" y="174" font-size="13" font-weight="700" fill="var(--ck-brand,#2563eb)"></text>
    </svg>
  </div>
  <div class="side">
    <div>
      <div class="head">二次函数图像与参数探究</div>
      <div class="eq" id="eq" style="margin-top:8px">y = x² - 2x - 3</div>
    </div>
    <div class="ctrl">
      <label class="row"><span>a</span><input id="sa" type="range" min="-3" max="3" step="0.25" value="${a0}"><span id="va">${a0}</span></label>
      <label class="row"><span>b</span><input id="sb" type="range" min="-6" max="6" step="0.5" value="${b0}"><span id="vb">${b0}</span></label>
      <label class="row"><span>c</span><input id="sc" type="range" min="-6" max="6" step="0.5" value="${c0}"><span id="vc">${c0}</span></label>
    </div>
    <div class="stats">
      <div class="stat"><small>开口与最值</small><b id="sOpen">向上 · 有最小值</b></div>
      <div class="stat"><small>对称轴</small><b id="sAxis">x = 1.00</b></div>
      <div class="stat"><small>顶点坐标</small><b id="sVtx">(1.00, -4.00)</b></div>
      <div class="stat"><small>判别式 Δ</small><b id="sDelta">16.0（2 个零点）</b></div>
    </div>
    <div class="btns">
      <button type="button" data-p="1,0,0">标准 y=x²</button>
      <button type="button" data-p="-1,2,3">开口向下</button>
      <button type="button" data-p="${a0},${b0},${c0}">重置</button>
    </div>
  </div>
</div>`;
  const js = `
const g=document.getElementById('grid'),S=25,OX=220,OY=180;
let gh='';
for(let i=-7;i<=7;i++){if(!i)continue;const x=OX+i*S;gh+='<line x1="'+x+'" y1="20" x2="'+x+'" y2="340"/>';}
for(let j=-6;j<=6;j++){if(!j)continue;const y=OY-j*S;gh+='<line x1="20" y1="'+y+'" x2="420" y2="'+y+'"/>';}
g.innerHTML=gh;
const sa=document.getElementById('sa'),sb=document.getElementById('sb'),sc=document.getElementById('sc');
function fmtTerm(v,sym,first){
  if(Math.abs(v)<1e-6)return '';
  const sign=v>0?(first?'':' + '):(first?'-':' - ');
  const av=Math.abs(v);
  const num=(sym&&Math.abs(av-1)<1e-6)?'':Number(av.toFixed(2));
  return sign+num+sym;
}
function draw(){
  let a=parseFloat(sa.value);
  if(Math.abs(a)<0.15){a=a>=0?0.25:-0.25;}
  const b=parseFloat(sb.value),c=parseFloat(sc.value);
  document.getElementById('va').textContent=a.toFixed(2).replace(/\\.00$/,'');
  document.getElementById('vb').textContent=b.toFixed(1).replace(/\\.0$/,'');
  document.getElementById('vc').textContent=c.toFixed(1).replace(/\\.0$/,'');
  const eq=('y = '+fmtTerm(a,'x²',true)+fmtTerm(b,'x',false)+fmtTerm(c,'',false)).replace(/\\s+/g,' ');
  document.getElementById('eq').textContent=eq;
  let d='';
  for(let px=20;px<=420;px+=3){
    const x=(px-OX)/S;
    const y=a*x*x+b*x+c;
    const py=OY-y*S;
    if(py>=-60&&py<=420) d+=(d?' L ':'M ')+px.toFixed(1)+' '+py.toFixed(1);
  }
  document.getElementById('curve').setAttribute('d',d);
  const h=-b/(2*a), k=c-(b*b)/(4*a), delta=b*b-4*a*c;
  const vx=OX+h*S, vy=OY-k*S;
  const axEl=document.getElementById('axisSym');
  axEl.setAttribute('x1',vx); axEl.setAttribute('x2',vx);
  const vtx=document.getElementById('vtx'), vl=document.getElementById('vtxLabel');
  vtx.setAttribute('cx',vx); vtx.setAttribute('cy',Math.max(16,Math.min(344,vy)));
  vl.setAttribute('x',Math.min(330,Math.max(24,vx+8)));
  vl.setAttribute('y',Math.max(28,Math.min(336,vy+(a>0?18:-10))));
  vl.textContent='('+h.toFixed(1)+', '+k.toFixed(1)+')';
  let rh='';
  if(delta>=0){
    const r1=(-b-Math.sqrt(delta))/(2*a), r2=(-b+Math.sqrt(delta))/(2*a);
    [r1,r2].forEach(r=>{const rx=OX+r*S;if(rx>=20&&rx<=420)rh+='<circle cx="'+rx.toFixed(1)+'" cy="'+OY+'" r="4.2" fill="var(--ck-bg,#fff)" stroke="var(--ck-brand,#2563eb)" stroke-width="2.2"/>';});
  }
  document.getElementById('roots').innerHTML=rh;
  document.getElementById('sOpen').textContent=a>0?'向上 · 极小值 '+k.toFixed(2):'向下 · 极大值 '+k.toFixed(2);
  document.getElementById('sAxis').textContent='x = '+h.toFixed(2);
  document.getElementById('sVtx').textContent='('+h.toFixed(2)+', '+k.toFixed(2)+')';
  document.getElementById('sDelta').textContent=delta.toFixed(1)+'（'+(delta>1e-6?'2 交点':delta>-1e-6?'1 切点':'无实根')+'）';
}
[sa,sb,sc].forEach(el=>el.addEventListener('input',draw));
document.querySelectorAll('[data-p]').forEach(btn=>btn.onclick=()=>{
  const p=btn.dataset.p.split(',');sa.value=p[0];sb.value=p[1];sc.value=p[2];draw();
});
draw();`;
  return wrapDoc('二次函数参数滑块', body, js);
}

function buildLinear(instruction = '') {
  const k0 = Math.max(-4, Math.min(4, parseNum(instruction, 'k', 1.5)));
  const b0 = Math.max(-5, Math.min(5, parseNum(instruction, 'b', 1)));
  const body = `
<div class="wrap">
  <div class="board">
    <svg viewBox="0 0 440 360" aria-label="一次函数坐标图像">
      <g id="grid" stroke="var(--ck-border,#cbd5e1)" stroke-width="1" opacity="0.65"></g>
      <line x1="20" y1="180" x2="420" y2="180" stroke="var(--ck-muted,#64748b)" stroke-width="1.8"/>
      <line x1="220" y1="20" x2="220" y2="340" stroke="var(--ck-muted,#64748b)" stroke-width="1.8"/>
      <line id="line" x1="20" y1="340" x2="420" y2="20" stroke="var(--ck-brand,#2563eb)" stroke-width="3.4"/>
      <circle id="py" cx="220" cy="180" r="5" fill="var(--ck-brand,#2563eb)" stroke="var(--ck-bg,#fff)" stroke-width="2"/>
      <circle id="px" cx="220" cy="180" r="5" fill="var(--ck-bg,#fff)" stroke="var(--ck-brand,#2563eb)" stroke-width="2.2"/>
      <text id="ly" x="228" y="175" font-size="13" font-weight="700" fill="var(--ck-brand,#2563eb)"></text>
    </svg>
  </div>
  <div class="side">
    <div>
      <div class="head">一次函数斜率与截距探究</div>
      <div class="eq" id="eq" style="margin-top:8px">y = 1.5x + 1</div>
    </div>
    <div class="ctrl">
      <label class="row"><span>斜率 k</span><input id="sk" type="range" min="-4" max="4" step="0.25" value="${k0}"><span id="vk">${k0}</span></label>
      <label class="row"><span>截距 b</span><input id="sb" type="range" min="-5" max="5" step="0.5" value="${b0}"><span id="vb">${b0}</span></label>
    </div>
    <div class="stats">
      <div class="stat"><small>单调性</small><b id="sMono">y 随 x 增大而增大</b></div>
      <div class="stat"><small>y 轴交点</small><b id="sY">(0, 1.0)</b></div>
      <div class="stat"><small>x 轴交点</small><b id="sX">(-0.67, 0)</b></div>
      <div class="stat"><small>经过象限</small><b id="sQuad">一、二、三</b></div>
    </div>
    <div class="btns">
      <button type="button" data-p="1,0">正比例 y=x</button>
      <button type="button" data-p="-1.5,2">k&lt;0 递减</button>
      <button type="button" data-p="${k0},${b0}">重置</button>
    </div>
  </div>
</div>`;
  const js = `
const g=document.getElementById('grid'),S=26,OX=220,OY=180;
let gh='';
for(let i=-7;i<=7;i++){if(!i)continue;const x=OX+i*S;gh+='<line x1="'+x+'" y1="20" x2="'+x+'" y2="340"/>';}
for(let j=-6;j<=6;j++){if(!j)continue;const y=OY-j*S;gh+='<line x1="20" y1="'+y+'" x2="420" y2="'+y+'"/>';}
g.innerHTML=gh;
const sk=document.getElementById('sk'),sb=document.getElementById('sb');
function draw(){
  const k=parseFloat(sk.value),b=parseFloat(sb.value);
  document.getElementById('vk').textContent=k.toFixed(2).replace(/\\.00$/,'');
  document.getElementById('vb').textContent=b.toFixed(1).replace(/\\.0$/,'');
  const bStr=Math.abs(b)<1e-6?'':(b>0?' + '+b:' - '+Math.abs(b));
  document.getElementById('eq').textContent=Math.abs(k)<1e-6?'y = '+b:'y = '+(k===1?'':k===-1?'-':k)+'x'+bStr;
  const x1=-8, y1=k*x1+b, x2=8, y2=k*x2+b;
  const ln=document.getElementById('line');
  ln.setAttribute('x1',OX+x1*S); ln.setAttribute('y1',OY-y1*S);
  ln.setAttribute('x2',OX+x2*S); ln.setAttribute('y2',OY-y2*S);
  const py=OY-b*S;
  document.getElementById('py').setAttribute('cy',Math.max(18,Math.min(342,py)));
  document.getElementById('ly').setAttribute('y',Math.max(26,Math.min(336,py-8)));
  document.getElementById('ly').textContent='(0, '+b.toFixed(1)+')';
  const pxEl=document.getElementById('px');
  if(Math.abs(k)>1e-6){
    const xr=-b/k; pxEl.style.display='';
    pxEl.setAttribute('cx',Math.max(18,Math.min(422,OX+xr*S)));
    document.getElementById('sX').textContent='('+xr.toFixed(2)+', 0)';
  } else { pxEl.style.display='none'; document.getElementById('sX').textContent='无 / 重合'; }
  document.getElementById('sY').textContent='(0, '+b.toFixed(1)+')';
  document.getElementById('sMono').textContent=k>0?'y 随 x 增大而增大':k<0?'y 随 x 增大而减小':'常函数（水平线）';
  const q=[];
  if(k>0&&b>0)q.push('一、二、三'); else if(k>0&&b<0)q.push('一、三、四');
  else if(k>0)q.push('一、三'); else if(k<0&&b>0)q.push('一、二、四');
  else if(k<0&&b<0)q.push('二、三、四'); else if(k<0)q.push('二、四');
  else q.push(b>0?'一、二':b<0?'三、四':'x 轴');
  document.getElementById('sQuad').textContent=q[0];
}
[sk,sb].forEach(el=>el.addEventListener('input',draw));
document.querySelectorAll('[data-p]').forEach(btn=>btn.onclick=()=>{const p=btn.dataset.p.split(',');sk.value=p[0];sb.value=p[1];draw();});
draw();`;
  return wrapDoc('一次函数斜率与截距', body, js);
}

function buildTrig(instruction = '') {
  const A0 = Math.max(0.5, Math.min(3, parseNum(instruction, 'A', 1.5)));
  const w0 = Math.max(0.5, Math.min(4, parseNum(instruction, 'w', 1)));
  const p0 = Math.max(-3.14, Math.min(3.14, parseNum(instruction, 'phi', 0)));
  const body = `
<div class="wrap">
  <div class="board">
    <svg viewBox="0 0 440 360" aria-label="三角函数图像变换">
      <line x1="20" y1="180" x2="420" y2="180" stroke="var(--ck-muted,#64748b)" stroke-width="1.6"/>
      <line x1="220" y1="24" x2="220" y2="336" stroke="var(--ck-muted,#64748b)" stroke-width="1.6"/>
      <path id="refWave" fill="none" stroke="var(--ck-muted,#64748b)" stroke-width="1.6" stroke-dasharray="5 5" opacity="0.55"/>
      <path id="wave" fill="none" stroke="var(--ck-brand,#2563eb)" stroke-width="3.2"/>
      <text x="30" y="42" font-size="12" fill="var(--ck-muted,#64748b)">虚线：y = sin x</text>
    </svg>
  </div>
  <div class="side">
    <div>
      <div class="head">三角函数图像变换</div>
      <div class="eq" id="eq" style="margin-top:8px">y = 1.5 sin(1x + 0)</div>
    </div>
    <div class="ctrl">
      <label class="row"><span>振幅 A</span><input id="sA" type="range" min="0.5" max="3" step="0.25" value="${A0}"><span id="vA">${A0}</span></label>
      <label class="row"><span>频率 ω</span><input id="sW" type="range" min="0.5" max="4" step="0.25" value="${w0}"><span id="vW">${w0}</span></label>
      <label class="row"><span>初相 φ</span><input id="sP" type="range" min="-3.14" max="3.14" step="0.26" value="${p0}"><span id="vP">${p0}</span></label>
    </div>
    <div class="stats">
      <div class="stat"><small>值域</small><b id="sRange">[-1.5, 1.5]</b></div>
      <div class="stat"><small>最小正周期 T</small><b id="sPeriod">2.00π</b></div>
    </div>
    <div class="btns">
      <button type="button" data-p="1,1,0">标准 sin x</button>
      <button type="button" data-p="2,2,1.04">二倍频移相</button>
    </div>
  </div>
</div>`;
  const js = `
const OX=220,OY=180,SX=30,SY=44;
let rd='';
for(let px=20;px<=420;px+=3){const x=(px-OX)/SX,py=OY-Math.sin(x)*SY;rd+=(rd?' L ':'M ')+px+' '+py.toFixed(1);}
document.getElementById('refWave').setAttribute('d',rd);
const sA=document.getElementById('sA'),sW=document.getElementById('sW'),sP=document.getElementById('sP');
function draw(){
  const A=parseFloat(sA.value),w=parseFloat(sW.value),p=parseFloat(sP.value);
  document.getElementById('vA').textContent=A.toFixed(2);
  document.getElementById('vW').textContent=w.toFixed(2);
  document.getElementById('vP').textContent=p.toFixed(2);
  document.getElementById('eq').textContent='y = '+A.toFixed(2)+' sin('+w.toFixed(2)+'x '+(p>=0?'+ ':'- ')+Math.abs(p).toFixed(2)+')';
  let d='';
  for(let px=20;px<=420;px+=2.5){const x=(px-OX)/SX,py=OY-A*Math.sin(w*x+p)*SY;d+=(d?' L ':'M ')+px.toFixed(1)+' '+py.toFixed(1);}
  document.getElementById('wave').setAttribute('d',d);
  document.getElementById('sRange').textContent='[-'+A.toFixed(2)+', '+A.toFixed(2)+']';
  document.getElementById('sPeriod').textContent=(2/w).toFixed(2)+'π';
}
[sA,sW,sP].forEach(el=>el.addEventListener('input',draw));
document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{const v=b.dataset.p.split(',');sA.value=v[0];sW.value=v[1];sP.value=v[2];draw();});
draw();`;
  return wrapDoc('三角函数图像变换', body, js);
}

function buildGeometryGlider() {
  const body = `
<div class="wrap">
  <div class="board">
    <svg viewBox="0 0 460 360" aria-label="几何动点与面积函数联动">
      <text x="26" y="34" font-size="14" font-weight="700" fill="var(--ck-brand,#2563eb)">矩形 ABCD（AB=6, BC=4）动点 P 沿 B→C→D 运动</text>
      <polygon id="tri" fill="var(--ck-brand,#2563eb)" fill-opacity="0.18" stroke="var(--ck-brand,#2563eb)" stroke-width="2.2"/>
      <rect x="34" y="96" width="180" height="120" fill="none" stroke="var(--ck-text,#1e293b)" stroke-width="2.2"/>
      <text x="20" y="232" font-size="13" font-weight="700" fill="var(--ck-text,#1e293b)">A</text>
      <text x="216" y="232" font-size="13" font-weight="700" fill="var(--ck-text,#1e293b)">B</text>
      <text x="216" y="90" font-size="13" font-weight="700" fill="var(--ck-text,#1e293b)">C</text>
      <text x="20" y="90" font-size="13" font-weight="700" fill="var(--ck-text,#1e293b)">D</text>
      <circle id="ptP" cx="214" cy="216" r="6.5" fill="var(--ck-brand,#2563eb)" stroke="var(--ck-bg,#fff)" stroke-width="2"/>
      <text id="lblP" x="224" y="214" font-size="13" font-weight="700" fill="var(--ck-brand,#2563eb)">P</text>
      <line x1="258" y1="250" x2="438" y2="250" stroke="var(--ck-muted,#64748b)" stroke-width="1.6"/>
      <line x1="258" y1="86" x2="258" y2="250" stroke="var(--ck-muted,#64748b)" stroke-width="1.6"/>
      <text x="418" y="268" font-size="12" fill="var(--ck-muted,#64748b)">路程 x</text>
      <text x="264" y="96" font-size="12" fill="var(--ck-muted,#64748b)">面积 S</text>
      <polyline points="258,250 326,118 428,118" fill="none" stroke="var(--ck-brand,#2563eb)" stroke-width="2.6"/>
      <circle id="ptGraph" cx="258" cy="250" r="5.5" fill="var(--ck-brand,#2563eb)" stroke="var(--ck-bg,#fff)" stroke-width="2"/>
    </svg>
  </div>
  <div class="side">
    <div>
      <div class="head">几何动点与分段面积函数</div>
      <div class="eq" id="eq" style="margin-top:8px">S = 3x（0 ≤ x ≤ 4）</div>
    </div>
    <div class="ctrl">
      <label class="row"><span>路程 x</span><input id="sx" type="range" min="0" max="10" step="0.1" value="2.5"><span id="vx">2.5</span></label>
    </div>
    <div class="stats">
      <div class="stat"><small>当前所在边</small><b id="sSeg">BC 边（上升段）</b></div>
      <div class="stat"><small>△ABP 面积 S</small><b id="sArea">7.50</b></div>
    </div>
    <div class="btns">
      <button type="button" class="pri" id="play">▶ 自动演示</button>
      <button type="button" id="toTurn">跳到拐点 C (x=4)</button>
    </div>
  </div>
</div>`;
  const js = `
const sx=document.getElementById('sx'),playBtn=document.getElementById('play');
const AX=34,AY=216,BX=214,BY=216;
let timer=0;
function draw(){
  const x=parseFloat(sx.value);
  document.getElementById('vx').textContent=x.toFixed(1);
  let px,py,area,seg,eq;
  if(x<=4){
    px=214; py=216-(x/4)*120; area=0.5*6*x;
    seg='BC 边（高随 x 匀速增大）'; eq='S = 3x（0 ≤ x ≤ 4）';
  } else {
    px=214-((x-4)/6)*180; py=96; area=12;
    seg='CD 边（底与高恒定）'; eq='S = 12（4 < x ≤ 10）';
  }
  document.getElementById('ptP').setAttribute('cx',px.toFixed(1));
  document.getElementById('ptP').setAttribute('cy',py.toFixed(1));
  document.getElementById('lblP').setAttribute('x',(px+8).toFixed(1));
  document.getElementById('lblP').setAttribute('y',(py-6).toFixed(1));
  document.getElementById('tri').setAttribute('points',AX+','+AY+' '+BX+','+BY+' '+px.toFixed(1)+','+py.toFixed(1));
  const gx=258+(x/10)*170, gy=250-(area/12)*132;
  document.getElementById('ptGraph').setAttribute('cx',gx.toFixed(1));
  document.getElementById('ptGraph').setAttribute('cy',gy.toFixed(1));
  document.getElementById('sSeg').textContent=seg;
  document.getElementById('sArea').textContent=area.toFixed(2);
  document.getElementById('eq').textContent=eq;
}
sx.addEventListener('input',draw);
document.getElementById('toTurn').onclick=()=>{sx.value='4';draw();};
playBtn.onclick=()=>{
  if(timer){clearInterval(timer);timer=0;playBtn.textContent='▶ 自动演示';return;}
  if(parseFloat(sx.value)>=9.9)sx.value='0';
  playBtn.textContent='⏸ 暂停';
  timer=setInterval(()=>{
    let next=parseFloat(sx.value)+0.12;
    if(next>=10){next=10;clearInterval(timer);timer=0;playBtn.textContent='▶ 自动演示';}
    sx.value=String(next);draw();
  },45);
};
draw();`;
  return wrapDoc('几何动点与面积探究', body, js);
}

function buildPythagoras(instruction = '') {
  const a0 = Math.max(2, Math.min(8, parseNum(instruction, 'a', 3)));
  const b0 = Math.max(2, Math.min(8, parseNum(instruction, 'b', 4)));
  const body = `
<div class="wrap">
  <div class="board">
    <svg viewBox="0 0 440 360" aria-label="勾股定理面积关系验证">
      <g id="shapes"></g>
    </svg>
  </div>
  <div class="side">
    <div>
      <div class="head">勾股定理：三正方形面积验证</div>
      <div class="eq" id="eq" style="margin-top:8px">3² + 4² = 5²（9 + 16 = 25）</div>
    </div>
    <div class="ctrl">
      <label class="row"><span>直角边 a</span><input id="sa" type="range" min="2" max="7" step="0.5" value="${a0}"><span id="va">${a0}</span></label>
      <label class="row"><span>直角边 b</span><input id="sb" type="range" min="2" max="7" step="0.5" value="${b0}"><span id="vb">${b0}</span></label>
    </div>
    <div class="stats">
      <div class="stat"><small>a² + b²</small><b id="sSum">25.00</b></div>
      <div class="stat"><small>斜边 c 与 c²</small><b id="sHyp">c = 5.00 · c² = 25.00</b></div>
    </div>
    <div class="btns">
      <button type="button" data-p="3,4">勾三股四弦五</button>
      <button type="button" data-p="5,5">等腰直角</button>
    </div>
  </div>
</div>`;
  const js = `
const sa=document.getElementById('sa'),sb=document.getElementById('sb'),g=document.getElementById('shapes');
function poly(pts,fill,op,label){
  const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length, cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;
  return '<polygon points="'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+'" fill="'+fill+'" fill-opacity="'+op+'" stroke="var(--ck-brand,#2563eb)" stroke-width="2"/>'
    +'<text x="'+cx.toFixed(1)+'" y="'+(cy+5).toFixed(1)+'" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ck-text,#1e293b)">'+label+'</text>';
}
function draw(){
  const a=parseFloat(sa.value), b=parseFloat(sb.value), c=Math.hypot(a,b);
  document.getElementById('va').textContent=a; document.getElementById('vb').textContent=b;
  const S=Math.min(24, 150/Math.max(a,b));
  const ox=175, oy=215;
  const C=[ox,oy], B=[ox+b*S,oy], A=[ox,oy-a*S];
  const sqA=[[ox-a*S,oy-a*S],A,C,[ox-a*S,oy]];
  const sqB=[C,B,[ox+b*S,oy+b*S],[ox,oy+b*S]];
  const dx=B[0]-A[0], dy=B[1]-A[1];
  const nx=dy, ny=-dx;
  const sqC=[A,B,[B[0]+nx,B[1]+ny],[A[0]+nx,A[1]+ny]];
  g.innerHTML=poly(sqA,'var(--ck-brand,#2563eb)',0.14,'a²='+(a*a).toFixed(1))
    +poly(sqB,'var(--ck-brand,#2563eb)',0.22,'b²='+(b*b).toFixed(1))
    +poly(sqC,'var(--ck-brand,#2563eb)',0.32,'c²='+(a*a+b*b).toFixed(1))
    +'<polygon points="'+A+' '+B+' '+C+'" fill="var(--ck-bg,#fff)" stroke="var(--ck-text,#1e293b)" stroke-width="2.4"/>';
  document.getElementById('eq').textContent=a+'² + '+b+'² = '+c.toFixed(2)+'²（'+(a*a+b*b).toFixed(1)+'）';
  document.getElementById('sSum').textContent=(a*a+b*b).toFixed(2);
  document.getElementById('sHyp').textContent='c = '+c.toFixed(2)+' · c² = '+(c*c).toFixed(2);
}
[sa,sb].forEach(el=>el.addEventListener('input',draw));
document.querySelectorAll('[data-p]').forEach(btn=>btn.onclick=()=>{const p=btn.dataset.p.split(',');sa.value=p[0];sb.value=p[1];draw();});
draw();`;
  return wrapDoc('勾股定理面积验证', body, js);
}

function buildStepDerivation() {
  const extraCss = `
.stepper{width:100%;height:100%;display:flex;flex-direction:column;justify-content:space-between;padding:18px 22px;gap:12px;background:var(--ck-bg,#fff)}
.st-top{display:flex;justify-content:space-between;align-items:center}
.st-list{display:flex;flex-direction:column;gap:8px;flex:1;justify-content:center}
.st-item{padding:10px 14px;border-radius:10px;border:1.5px solid var(--ck-border,#cbd5e1);background:var(--ck-surface,#f8fafc);opacity:.42;transform:translateX(0);transition:all 280ms cubic-bezier(.2,.8,.2,1);display:flex;justify-content:space-between;align-items:center;gap:12px}
.st-item.done{opacity:.85}
.st-item.cur{opacity:1;border-color:var(--ck-brand,#2563eb);box-shadow:0 4px 14px rgba(0,0,0,.06);transform:translateX(4px)}
.st-math{font-size:clamp(16px,2.4vmin,22px);font-weight:700;font-variant-numeric:tabular-nums}
.st-why{font-size:clamp(12px,1.8vmin,15px);color:var(--ck-brand,#2563eb);font-weight:600}
`;
  const body = `
<div class="stepper">
  <div class="st-top">
    <div class="head">分步推导演示：配方法化二次函数顶点式</div>
    <span id="prog" style="font-size:13px;color:var(--ck-muted,#64748b);font-weight:600">步骤 1 / 4</span>
  </div>
  <div class="st-list" id="list">
    <div class="st-item cur"><span class="st-math">y = ax² + bx + c  (a ≠ 0)</span><span class="st-why">原一般式</span></div>
    <div class="st-item"><span class="st-math">y = a [ x² + (b/a)x ] + c</span><span class="st-why">提取二次项系数 a</span></div>
    <div class="st-item"><span class="st-math">y = a [ (x + b/2a)² - b²/4a² ] + c</span><span class="st-why">加上并减去一次项系数一半的平方</span></div>
    <div class="st-item"><span class="st-math">y = a(x + b/2a)² + (4ac - b²)/4a</span><span class="st-why">去中括号合并常数，得顶点坐标</span></div>
  </div>
  <div class="btns" style="justify-content:flex-end">
    <button type="button" id="prev">上一步</button>
    <button type="button" class="pri" id="next">下一步</button>
    <button type="button" id="reset">重置</button>
  </div>
</div>`;
  const js = `
let idx=0;
const items=[...document.querySelectorAll('.st-item')],prog=document.getElementById('prog');
function sync(){
  items.forEach((el,i)=>{el.classList.toggle('cur',i===idx);el.classList.toggle('done',i<idx);});
  prog.textContent='步骤 '+(idx+1)+' / '+items.length;
  document.getElementById('prev').disabled=idx===0;
  document.getElementById('next').disabled=idx===items.length-1;
}
document.getElementById('prev').onclick=()=>{if(idx>0){idx--;sync();}};
document.getElementById('next').onclick=()=>{if(idx<items.length-1){idx++;sync();}};
document.getElementById('reset').onclick=()=>{idx=0;sync();};
sync();`;
  return wrapDoc('分步公式推导', body, js, extraCss);
}

/**
 * 根据自然语言描述自动识别最匹配的参数化内置模板；未命中返回 null（回退 AI 自由生成）。
 */
export function detectWidgetTemplate(instruction = '') {
  const s = String(instruction || '').trim();
  if (!s) return null;
  if (/勾股|弦图|直角三角形.*面积|a\^?2\s*\+\s*b\^?2/i.test(s)) return 'pythagoras-visual';
  if (/二次函数|抛物线|ax\^?2|x²|顶点式/.test(s)) return 'quadratic-explorer';
  if (/一次函数|正比例函数|斜率.*截距|kx\s*\+\s*b/i.test(s)) return 'linear-explorer';
  if (/三角函数|正弦|余弦|sin|cos|振幅.*周期/i.test(s)) return 'trig-explorer';
  if (/动点|几何变换|轨迹|沿.*边.*运动|glider/i.test(s)) return 'geometry-glider';
  if (/公式推导|配方法.*步骤|逐步展开|分步推导/.test(s)) return 'step-derivation';
  return null;
}

export function buildWidgetFromTemplate(templateId, instruction = '') {
  switch (templateId) {
    case 'quadratic-explorer':
      return { id: templateId, html: buildQuadratic(instruction), note: '已应用内置模板：二次函数参数滑块' };
    case 'linear-explorer':
      return { id: templateId, html: buildLinear(instruction), note: '已应用内置模板：一次函数斜率截距' };
    case 'trig-explorer':
      return { id: templateId, html: buildTrig(instruction), note: '已应用内置模板：三角函数图像变换' };
    case 'geometry-glider':
      return { id: templateId, html: buildGeometryGlider(instruction), note: '已应用内置模板：几何动点与面积探究' };
    case 'pythagoras-visual':
      return { id: templateId, html: buildPythagoras(instruction), note: '已应用内置模板：勾股定理面积拼图' };
    case 'step-derivation':
      return { id: templateId, html: buildStepDerivation(instruction), note: '已应用内置模板：分步公式推导器' };
    default:
      return null;
  }
}
