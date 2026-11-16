/* 引擎自动化测试：在 node 中以 DOM stub 加载 才干罗盘_MVP1.html，跑 N 次随机全流程 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', '才干罗盘_MVP1.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 script 块'); process.exit(1); }
const code = m[1];

/* ---------- DOM stub ---------- */
function makeNode() {
  return {
    innerHTML: '', textContent: '', value: '', disabled: false, className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild() {}, removeChild() {}, select() {}, closest() { return null; },
    parentNode: null, querySelectorAll() { return []; }, querySelector() { return null; }
  };
}
const docStub = {
  getElementById() { return makeNode(); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  createElement() { return makeNode(); },
  addEventListener() {},
  body: makeNode(),
  execCommand() { return true; }
};

const setTimeoutStub = (fn) => { /* 测试里不自动跳转，由用例显式调用 gotoRescue */ return 0; };
const clearTimeoutStub = () => {};

const context = {
  document: docStub,
  window: {},
  console,
  navigator: {},
  localStorage: {
    _d: {},
    setItem(k, v) { this._d[k] = v; },
    getItem(k) { return this._d[k] || null; },
    removeItem(k) { delete this._d[k]; }
  },
  setTimeout: setTimeoutStub,
  clearTimeout: clearTimeoutStub,
  Math, Date, JSON, Array, Object, String, Number
};
context.window.console = console;
context.window.scrollTo = () => {};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(code, context, { filename: 'kairos.js' });

const K = context.window.__KAIROS__;
if (!K) { console.error('调试出口未挂载'); process.exit(1); }

/* ---------- 断言工具 ---------- */
let fail = 0;
const errs = [];
function check(cond, msg) {
  if (!cond) { fail++; if (errs.length < 40) errs.push(msg); }
}

/* ---------- 数据完整性 ---------- */
const T = K.TALENTS;
check(T.length === 34, `才干数量应为 34，实际 ${T.length}`);
const dc = { S: 0, E: 0, R: 0, I: 0 };
const ids = {}, names = {};
T.forEach(t => {
  dc[t.d]++;
  check(!ids[t.id], `id 重复：${t.id}`);
  check(!names[t.name], `name 重复：${t.name}`);
  ids[t.id] = 1; names[t.name] = 1;
  ['id', 'name', 'd', 'def', 'q', 'v'].forEach(f => check(!!t[f], `${t.id} 缺字段 ${f}`));
  check(t.q.length >= 12 && t.q.length <= 40, `${t.name} 行为句长度 ${t.q.length}`);
});
Object.keys(dc).forEach(k => check(dc[k] === 8 || dc[k] === 9, `域 ${k} 项数 ${dc[k]} 不在 8-9`));

/* 原型 16 型齐全 */
const need = ['S', 'E', 'R', 'I'];
['S', 'E', 'R', 'I'].forEach(a => ['S', 'E', 'R', 'I'].forEach(b => {
  if (a !== b) need.push(a + '·' + b);
}));
need.forEach(c => check(!!K.ARCHETYPES[c], `原型缺失 ${c}`));

/* 文案覆盖：所有可能出现的 code_pos */
let descMissing = [];
need.forEach(c => {
  const isSingle = c.indexOf('·') < 0;
  ['main', 'sub'].forEach(pos => {
    if (isSingle && pos === 'sub') return;
    if (!K.DESC[c + '_' + pos]) descMissing.push(c + '_' + pos);
  });
});
check(descMissing.length === 0, `文案缺失：${descMissing.join(',')}`);

/* 建议 + 预警 */
['S', 'E', 'R', 'I'].forEach(k => {
  check(K.ADVICE[k] && K.ADVICE[k].length >= 3, `建议库 ${k} 不足 3 条`);
  K.ADVICE[k].forEach((a, i) => {
    ['title', 'do', 'why', 'done'].forEach(f => check(!!a[f], `建议 ${k}[${i}] 缺 ${f}`));
  });
});
T.forEach(t => {
  const d = K.DRAIN[t.id];
  check(!!d, `耗电预警缺失 ${t.name}`);
  if (d) check(!!d.scene && !!d.actionText, `耗电预警 ${t.name} 字段不全`);
});

/* ---------- 配对用例 T-01 ~ T-05 ---------- */
function pairsOf(n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(T[i].id);
  return K.buildRound(arr);
}
check(pairsOf(34).pairs.length === 17 && !pairsOf(34).bye, 'T-01 34 项应 17 组无轮空');
check(pairsOf(17).pairs.length === 8 && !!pairsOf(17).bye, 'T-02 17 项应 8 组 1 轮空');
check(pairsOf(18).pairs.length === 9 && !pairsOf(18).bye, 'T-03 18 项应 9 组无轮空');
check(pairsOf(9).pairs.length === 4 && !!pairsOf(9).bye, 'T-04 9 项应 4 组 1 轮空');
check(pairsOf(10).pairs.length === 5 && !pairsOf(10).bye, 'T-05 10 项应 5 组无轮空');

/* ---------- 全流程模拟 ---------- */
function simulate(opts) {
  const noneRate = opts.noneRate || 0;
  const rescueRate = opts.rescueRate || 0;
  const S = K.state;

  K.start();
  let guard = 0;
  let pairTotal = 0;
  let rescueCount = 0;
  const rescueTimes = [];

  while (S.stage !== 'result' && guard++ < 500) {
    if (S.stage === 'duel') {
      const left = S.pairs.length - S.pairIndex;
      check(left > 0, '对决阶段剩余组数为 0');
      for (let i = 0; i < left; i++) {
        const r = Math.random();
        let choice;
        /* 第 3 轮界面没有「都不像我」，模拟时也不产生该选择 */
        if (S.round < 3 && r < noneRate) choice = 'none';
        else if (r < noneRate + (1 - noneRate) / 2) choice = 'a';
        else choice = 'b';
        K.resolvePair(choice);
        pairTotal++;
      }
    } else if (S.stage === 'roundEnd') {
      K.gotoRescue();
    } else if (S.stage === 'rescue') {
      const pool = S.losers.filter(id => S.rescued.indexOf(id) < 0);
      if (pool.length && Math.random() < rescueRate) {
        rescueTimes.push(S.round);
        rescueCount++;
        K.doRescue(pool[Math.floor(Math.random() * pool.length)]);
      } else {
        K.doRescue(null);
      }
    } else if (S.stage === 'order') {
      const id = S.orderPool[Math.floor(Math.random() * S.orderPool.length)];
      K.pickFirst(id);
    } else {
      break;
    }
  }

  return { S, pairTotal, rescueTimes, rescueCount };
}

const runs = 300;
const codes = {};
const gaps = { min: 101, max: -1 };
let pairMin = 999, pairMax = 0;
let scoreOut = 0;
let top5Bad = 0;
let archBad = 0;
let descBad = 0;

for (let n = 0; n < runs; n++) {
  const { S, pairTotal } = simulate({ noneRate: 0.06, rescueRate: 0.55 });

  if (S.stage !== 'result') { archBad++; continue; }

  const r = S.result;
  if (!r) { archBad++; continue; }

  /* 五强唯一且合法 */
  if (r.top5.length !== 5) top5Bad++;
  const set = {};
  r.top5.forEach(id => {
    if (set[id]) top5Bad++;
    set[id] = 1;
    if (!K.getTalent(id)) top5Bad++;
  });

  /* 全 34 项都有分，且范围合法 */
  let missing = 0;
  Object.keys(r.item).forEach(id => {
    const v = r.item[id];
    if (v < 25 || v > 100) scoreOut++;
  });
  T.forEach(t => { if (typeof r.item[t.id] !== 'number') missing++; });
  if (missing) scoreOut++;

  /* 域分 */
  ['S', 'E', 'R', 'I'].forEach(k => {
    const v = r.dom[k];
    if (!(v >= 0 && v <= 100)) scoreOut++;
  });
  const dv = ['S', 'E', 'R', 'I'].map(k => r.dom[k]);
  const gap = Math.max.apply(null, dv) - Math.min.apply(null, dv);
  gaps.min = Math.min(gaps.min, gap);
  gaps.max = Math.max(gaps.max, gap);

  /* 原型 code 合法 */
  if (!K.ARCHETYPES[r.arch.code]) archBad++;
  codes[r.arch.code] = (codes[r.arch.code] || 0) + 1;

  /* 文案命中 */
  const firstDom = K.getTalent(r.top5[0]).d;
  const pos = firstDom === r.arch.main ? 'main' : 'sub';
  const key = r.arch.code + '_' + pos;
  let txt = K.DESC[key];
  if (!txt) txt = K.DESC[r.arch.code + '_main'] || K.DESC[r.arch.main];
  if (!txt || txt.length !== 4) descBad++;
  else {
    const joined = txt.join('').replace(/\{low\}/g, 'x');
    if (joined.length < 110 || joined.length > 180) descBad++;
  }

  /* 建议 3 条、耗电 3 项且同域 */
  if (r.advice.length !== 3) archBad++;
  if (r.drain.length !== 3) archBad++;

  pairMin = Math.min(pairMin, pairTotal);
  pairMax = Math.max(pairMax, pairTotal);
}

/* ---------- 定向用例 ---------- */
/* 全选 A：无弃权 */
(function () {
  const S = K.state;
  K.start();
  let g = 0;
  while (S.stage === 'duel' && g++ < 100) {
    for (let i = 0; i < S.pairs.length - S.pairIndex; i++) K.resolvePair('a');
  }
  check(S.winners.length === 17, `全选 A 应 17 项晋级，实际 ${S.winners.length}`);
  const uniq = {}; let dup = 0;
  S.winners.forEach(id => { if (uniq[id]) dup++; uniq[id] = 1; });
  check(dup === 0, '全选 A 出现重复晋级');
})();

/* 全选「都不像我」：R1 应 0 项晋级（理论上会走进补足逻辑，检查不崩） */
(function () {
  const S = K.state;
  K.start();
  let g = 0;
  while (S.stage === 'duel' && g++ < 100) {
    for (let i = 0; i < S.pairs.length - S.pairIndex; i++) K.resolvePair('none');
  }
  check(S.stage === 'roundEnd' || S.stage === 'rescue', '全弃权后状态异常：' + S.stage);
})();

/* 单域型判定 */
check(K.judgeArchetype(['fenxi', 'siwei', 'xuexi', 'shouji', 'tiliang']).code === 'S', 'T-10 单域判定失败');
/* S3 R2 → S·R */
(function () {
  const r = K.judgeArchetype(['fenxi', 'siwei', 'xuexi', 'tiliang', 'hexie']);
  check(r.code === 'S·R', 'T-11 期望 S·R，实际 ' + r.code);
})();
/* S2 R2，Top1 在 R → R·S */
(function () {
  const r = K.judgeArchetype(['tiliang', 'hexie', 'fenxi', 'siwei', 'xingdong']);
  check(r.code === 'R·S', 'T-12 期望 R·S，实际 ' + r.code);
})();

/* ---------- 输出 ---------- */
console.log('================ 引擎测试结果 ================');
console.log(`随机全流程      : ${runs} 次`);
console.log(`失败断言        : ${fail}`);
console.log(`对局总数范围    : ${pairMin} – ${pairMax} 场（规格 29–31，未捞回时含轮空）`);
console.log(`五强异常        : ${top5Bad}`);
console.log(`原型/建议异常   : ${archBad}`);
console.log(`文案异常        : ${descBad}`);
console.log(`分值越界        : ${scoreOut}`);
console.log(`域分极差范围    : ${gaps.min} – ${gaps.max}`);
console.log(`命中的原型分布  :`);
Object.keys(codes).sort((a, b) => codes[b] - codes[a]).forEach(c => {
  console.log(`   ${c.padEnd(5)} ${K.ARCHETYPES[c].name}  ${codes[c]}`);
});
if (errs.length) {
  console.log('---- 前若干条失败详情 ----');
  errs.forEach(e => console.log('  ✗ ' + e));
}
console.log('==============================================');
process.exit(fail === 0 ? 0 : 1);
