# 知时 Kairos · 才干罗盘 · 技术架构与详细设计

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 对应规格 | 知时Kairos_产品功能规格文档_v1.0 |
| 交付形态 | 单文件 `index.html` |
| 目标环境 | iOS Safari 15+ / Android Chrome 90+ / 微信内置浏览器 |

---

## 1. 架构总览

### 1.1 设计前提

这个产品的技术约束决定了架构，倒推如下：

| 约束 | 来源 | 后果 |
|---|---|---|
| 双击即可运行 | 用户要发给朋友 | 不能有构建步骤 |
| 离线可用 | 用户可能在无网环境打开 | 不能有 CDN 依赖 |
| 手机上打开 | 目标场景 | 必须移动优先 |
| 3 分钟完成 | 产品定义 | 不能有加载等待 |
| 零运维 | 个人项目，无服务器 | 不能有后端 |

**唯一满足全部约束的形态：单个 HTML 文件，零外部依赖。**

### 1.2 架构图

```
index.html
│
├── <style>                          样式层
│   ├── :root tokens                 设计变量
│   ├── 基础重置
│   └── 组件样式
│
├── <body>
│   ├── #app                         唯一挂载点
│   └── <script>                     逻辑层
│
└── <script>
    │
    ├── DATA        静态数据（34 项 / 16 型 / 32 套文案 / 16 条建议 / 34 条预警 / 二维码 base64）
    │                   ↑ 只读，无副作用
    │
    ├── STORE       持久化（localStorage 读写、版本校验、过期清理）
    │                   ↑ 唯一接触外部存储的模块
    │
    ├── ENGINE      赛制引擎（配对、晋级、捞回、定序）
    │                   ↑ 纯函数，不碰 DOM
    │
    ├── SCORE       计算（单项分、域分、原型判定、文案选取）
    │                   ↑ 纯函数，不碰 DOM
    │
    ├── RENDER      视图渲染（视图切换、组件生成、雷达图 SVG）
    │                   ↑ 唯一写 DOM 的模块
    │
    ├── SHARE       分享（URL 编码、Canvas 出图、剪贴板）
    │
    └── APP         控制器（事件绑定、状态流转、模块编排）
                        ↑ 唯一持有全局 state 的地方
```

### 1.3 模块依赖

```
APP ──→ ENGINE ──→ DATA
 │        │
 │        └──→ 无外部依赖
 │
 ├──→ SCORE ──→ DATA
 │
 ├──→ RENDER ──→ DATA, UI-TOKENS
 │
 ├──→ SHARE ──→ 无模块依赖
 │
 └──→ STORE ──→ 无模块依赖（仅 localStorage）
```

**关键约束**：`ENGINE` 与 `SCORE` 不得引用 `RENDER`，`DATA` 不得引用任何模块。这样引擎可以脱离界面单独测试。

---

## 2. 技术选型

| 项 | 选择 | 理由 | 备选与否决原因 |
|---|---|---|---|
| 框架 | 无（原生 DOM） | 全站只有 3 个视图、约 10 个组件，框架的收益小于成本 | React/Vue：需要构建或 CDN，违反零依赖 |
| 状态管理 | 单一 state 对象 + 手动重渲染 | 状态简单，无并发 | 不可变数据流：过度设计 |
| 样式 | 原生 CSS + 自定义属性 | 无编译步骤 | Tailwind CDN：体积大且需网络 |
| 图标 | 内联 SVG | 只有 5 个图标 | 图标库：体积浪费 |
| 雷达图 | 内联 SVG（动态生成） | 可 CSS 控色、高分屏清晰、可复制到 Canvas | Canvas 直接绘制：缩放模糊 |
| 结果卡 | Canvas 2D | 需要导出 PNG | html2canvas：需依赖，且中文渲染不可控 |
| 存储 | localStorage | 单值、无并发 | IndexedDB：过度设计 |
| 字体 | 系统字体栈 | 中文 web font 3–8MB，会毁掉首屏 | 思源黑体子集：体积不可控 |

---

## 3. 数据结构

### 3.1 静态数据

```js
// 才干项
const TALENTS = [{
  id: 'shouji',        // 拼音唯一标识
  name: '搜集',         // 展示名
  d: 'S',              // 域：S/E/R/I
  def: '把有用的东西收进来，越多越安心',
  q: '没人要求，我也会把一件事查到底。',
  v: '能在 2 小时内把一个主题的可用资料找齐并整理成清单'
}];

// 原型
const ARCHETYPES = {
  'S':   { name:'探索者', img:'对世界本身着迷，广度惊人，问题问得比答案多', pit:'停在理解，不推向结论' },
  'S·R': { name:'解读者', img:'把人看明白，也把事情看明白，擅长替别人把他自己说不清的话说清', pit:'看得太透，反而难以投入' },
  // ... 共 16 条
};

// 定位描述：key = 原型代码 + '_' + 首位域相对位置（main/sub）
const DESCRIPTIONS = {
  'S·R_main': ['段落1', '段落2', '段落3', '段落4'],
  'S·R_sub' : ['段落1', '段落2', '段落3', '段落4'],
  // ... 共 32 条
};

// 行动建议：按最低域索引
const ADVICE = {
  S: [ {title,do,why,done}, ... ],  // 4 条
  E: [ ... ],
  R: [ ... ],
  I: [ ... ]
};

// 耗电预警：按才干 id 索引
const DRAIN = {
  tongchou: { scene:'一屋子人各有想法，要你排谁先谁后', action:'协作', actionText:'把排序这件事交给那个天生爱排的人' },
  // ... 34 条
};
```

### 3.2 运行时状态

```js
const state = {
  // 阶段机
  stage: 'intro',      
  // 'intro' | 'duel' | 'roundEnd' | 'rescue' | 'order' | 'result'

  // 赛制
  round: 0,            // 0=未开始, 1/2/3
  queue: [],           // 当前轮候选 id 数组
  pairs: [],           // [[id,id], ...]
  pairIndex: 0,        // 当前作答到第几组
  bye: null,           // 本轮轮空 id

  winners: [],         // 本轮晋级
  losers: [],          // 本轮淘汰
  rescued: [],         // 已被捞回的 id（防止重复捞）
  blockedPair: false,  // 180ms 防连点锁

  // 全域累计
  history: [],         // [{a, b, win:'a'|'b'|'none', round}]
  eliminatedAt: {},    // { id: 1|2|3 } 出局轮次

  // 定序
  orderPool: [],       // 定序候选
  order: [],           // 最终排名 [id...]

  // 输出
  result: null,        // { top5:[], scores:{S,E,R,I}, archetype:'S·R', descKey }

  // 派生缓存（每次重算，不存储）
  dom: {}
};
```

### 3.3 存储格式

```js
// key: 'kairos_v1'
{
  v: 1,
  ts: 1757_000_000_000,     // 最后写入时间戳
  stage: 'duel',
  round: 2,
  queue: ['shouji', ...],
  pairs: [['shouji','hexie'], ...],
  pairIndex: 3,
  bye: 'zhudao',
  winners: [...],
  losers: [...],
  rescued: [...],
  history: [...],
  eliminatedAt: {...},
  orderPool: [],
  order: [],
  result: null
}
```

**不存**：`blockedPair`、`dom`（运行时临时量）。

---

## 4. 核心算法

### 4.1 配对

```js
function buildRound(queue) {
  const n = queue.length;
  const arr = shuffle([...queue]);          // Fisher-Yates
  let bye = null, rest = arr;

  if (n % 2 === 1) {
    bye = arr[0];
    rest = arr.slice(1);
  }

  const pairs = [];
  for (let i = 0; i < rest.length; i += 2) {
    pairs.push([rest[i], rest[i + 1]]);
  }
  return { pairs, bye, queue: arr };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

**为什么在轮开始时洗一次**：如果每对单独随机，同一轮的配对关系会失去整体均衡（比如某两项总被安排在一起）。整轮洗牌保证每项与其他项相遇的概率均等。

### 4.2 对决结算

```js
function resolvePair(pairIdx, choice) {
  const [a, b] = state.pairs[pairIdx];

  if (choice === 'a') {
    state.winners.push(a);
    state.losers.push(b);
    state.eliminatedAt[b] = state.round;
  } else if (choice === 'b') {
    state.winners.push(b);
    state.losers.push(a);
    state.eliminatedAt[a] = state.round;
  } else {                                  // 'none'
    state.losers.push(a, b);
    state.eliminatedAt[a] = state.round;
    state.eliminatedAt[b] = state.round;
  }

  state.history.push({ a, b, win: choice, round: state.round });
  save();
}
```

### 4.3 轮次收尾

```js
function endRound() {
  if (state.bye) state.winners.push(state.bye);

  // R3 无捞回，直接定序
  if (state.round === 3) {
    state.orderPool = [...state.winners];
    state.stage = 'order';
    return;
  }
  // R1/R2 进入捞回
  state.stage = 'rescue';
}
```

### 4.4 捞回

```js
function rescue(id) {
  if (!id) { advanceToNextRound(); return; }
  if (state.rescued.includes(id)) return;   // 不可重复捞
  state.rescued.push(id);
  state.winners.push(id);
  advanceToNextRound();
}

function advanceToNextRound() {
  state.round += 1;
  state.queue = [...state.winners];
  state.winners = [];
  state.losers = [];
  const { pairs, bye, queue } = buildRound(state.queue);
  state.pairs = pairs;
  state.bye = bye;
  state.queue = queue;
  state.pairIndex = 0;
  state.stage = 'duel';
  save();
}
```

**人数推演验证**

| 起始 | 捞回 | 下一轮 queue 长度 | 组数 | 轮空 |
|---|---|---|---|---|
| 34 → 17 胜 | +1 | 18 | 9 | 0 |
| 34 → 17 胜 | 0 | 17 | 8 | 1 |
| 18 → 9 胜 | +1 | 10 | 5 | 0 |
| 17 → 9 胜 | 0 | 9 | 4 | 1 |

### 4.5 定序（多选一）

```js
function pickFirst(id) {
  state.order.push(id);
  state.orderPool = state.orderPool.filter(x => x !== id);

  if (state.orderPool.length === 1) {
    state.order.push(state.orderPool[0]);   // 剩下那个自动第 5
    state.orderPool = [];
    finalize();                              // → 结算并进入结果页
  }
  save();
}
```

4 次点击完成 5 强排序，第 5 名自动落位。

### 4.6 计分

```js
const SCORE_BY_ROUND = { 1: 25, 2: 45, 3: 65 };
const SCORE_BY_RANK  = [100, 94, 89, 84, 78];  // index 0 = 第1名

function computeScores() {
  const s = {};

  TALENTS.forEach(t => {
    const rank = state.order.indexOf(t.id);
    if (rank >= 0) {
      s[t.id] = SCORE_BY_RANK[rank];
    } else {
      let base = SCORE_BY_ROUND[state.eliminatedAt[t.id]] ?? 25;
      if (state.rescued.includes(t.id)) base = Math.min(base + 8, 70);
      s[t.id] = base;
    }
  });

  const domain = { S: [], E: [], R: [], I: [] };
  TALENTS.forEach(t => domain[t.d].push(s[t.id]));

  const scores = {};
  for (const k in domain) {
    const arr = domain[k];
    scores[k] = Math.round(arr.reduce((x, y) => x + y, 0) / arr.length);
  }
  return { itemScores: s, domainScores: scores };
}
```

### 4.7 原型判定

```js
function judgeArchetype(top5) {
  const cnt = { S:0, E:0, R:0, I:0 };
  top5.forEach(id => { cnt[getTalent(id).d]++; });

  const sorted = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  const [t1, t2] = sorted;

  // 并列时以 Top1 才干所属域为主域
  const firstDomain = getTalent(top5[0]).d;
  let main = t1, sub = t2;
  if (cnt[t1] === cnt[t2] && firstDomain !== t1) {
    main = firstDomain;
    sub = t1;
  }

  // 单域：占比 ≥3 且 与次高差 ≥2
  if (cnt[main] >= 3 && cnt[main] - cnt[sub] >= 2) {
    return { code: main, main, sub: null };
  }
  return { code: `${main}·${sub}`, main, sub };
}
```

### 4.8 文案选取

```js
function pickDescription(arch, top5) {
  // 首位才干在主域 → main；在副域 → sub
  const firstDomain = getTalent(top5[0]).d;
  const pos = (firstDomain === arch.main) ? 'main' : 'sub';
  const key = `${arch.code}_${pos}`;

  // 容错：单域型只有 main 一种
  return DESCRIPTIONS[key] || DESCRIPTIONS[`${arch.code}_main`];
}
```

**32 套的必要性**：同样判为「解读者」，首位才干是「体谅」（副域）和是「搜集」（主域）时，这个人的发力方式完全不同——前者先感受人，后者先搞清事。描述第一段必须跟着变。

---

## 5. 状态机

```
                    ┌─────────┐
                    │  INTRO  │
                    └────┬────┘
                         │ 点击开始
                         ▼
              ┌──────────────────────┐
              │                     │
              │       DUEL          │◄──────┐
              │  (pairIndex 递增)    │       │
              └────┬────────────┬────┘       │
        pairIndex 未满         已满           │
                   │            │            │
                   └──► 停留 ◄──┘            │
                                │            │
                                ▼            │
                        ┌──────────────┐     │
                   R3   │  ROUND_END   │ R1/R2
                   ┌────┴──────────────┴──┐  │
                   │                      │  │
                   ▼                      ▼  │
             ┌──────────┐          ┌────────┐│
             │  ORDER   │          │ RESCUE ││
             └────┬─────┘          └───┬────┘│
                  │ 选满4次              │     │
                  │                     └─────┘
                  ▼                     (捞回后回 DUEL)
             ┌──────────┐
             │  RESULT  │
             └──────────┘
```

**状态持久化点**：每次离开一个状态时写入。

---

## 6. 存储设计

### 6.1 读写封装

```js
const KEY = 'kairos_v1';
let memoryFallback = null;      // localStorage 不可用时的降级

function storageAvailable() {
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    return true;
  } catch (e) { return false; }
}

function save() {
  const snap = {
    v: 1, ts: Date.now(),
    stage: state.stage, round: state.round,
    queue: state.queue, pairs: state.pairs, pairIndex: state.pairIndex,
    bye: state.bye, winners: state.winners, losers: state.losers,
    rescued: state.rescued, history: state.history,
    eliminatedAt: state.eliminatedAt,
    orderPool: state.orderPool, order: state.order,
    result: state.result
  };
  const raw = JSON.stringify(snap);
  if (storageAvailable()) {
    try { localStorage.setItem(KEY, raw); } catch (e) {}
  } else {
    memoryFallback = raw;
  }
}

function load() {
  let raw = memoryFallback;
  if (storageAvailable()) raw = localStorage.getItem(KEY);
  if (!raw) return null;

  try {
    const s = JSON.parse(raw);
    if (s.v !== 1) { clear(); return null; }                     // 版本不符
    if (Date.now() - s.ts > 30 * 864e5) { clear(); return null; } // 过期 30 天
    return s;
  } catch (e) { clear(); return null; }
}
```

### 6.2 恢复策略

| 存储中的 stage | 恢复行为 |
|---|---|
| `intro` | 显示开场页 |
| `duel` | 弹恢复提示，「继续」回到当前组开头（该组重答） |
| `roundEnd` / `rescue` | 弹恢复提示，回到捞回页 |
| `order` | 弹恢复提示，回到定序 |
| `result` | 直接渲染结果页 |

**为什么回到"组开头"而不是"组中间"**：组中间意味着已经选了一个但没写盘，恢复时无法知道选了哪个。回到组开头代价最小。

---

## 7. 渲染设计

### 7.1 视图切换

只有一个挂载点 `#app`，整体替换 innerHTML。

```js
function render() {
  const app = document.getElementById('app');
  switch (state.stage) {
    case 'intro':    app.innerHTML = viewIntro();    break;
    case 'duel':     app.innerHTML = viewDuel();     break;
    case 'roundEnd': app.innerHTML = viewRoundEnd(); break;
    case 'rescue':   app.innerHTML = viewRescue();   break;
    case 'order':    app.innerHTML = viewOrder();    break;
    case 'result':   app.innerHTML = viewResult();   break;
  }
  bindEvents();
}
```

**为什么整体替换而非增量更新**：单次渲染的元素数量在 50 以内，整体替换耗时 < 5ms，但能消除所有状态不同步的 bug。增量更新在这个规模下是负收益。

### 7.2 事件绑定

用事件委托，绑在 `#app` 上，避免每次渲染重新绑定带来的内存泄漏。

```js
document.getElementById('app').addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id  = el.dataset.id;

  switch (act) {
    case 'start':   start(); break;
    case 'pick':    onPick(id); break;     // 'a' | 'b' | 'none'
    case 'rescue':  onRescueSelect(id); break;
    case 'doRescue': doRescue(); break;
    case 'skipRescue': advanceToNextRound(); break;
    case 'orderPick': pickFirst(id); break;
    case 'share':   shareLink(); break;
    case 'saveImg': saveImage(); break;
    case 'copy':    copyText(); break;
  }
});
```

### 7.3 对决页渲染

```js
function viewDuel() {
  const [a, b] = state.pairs[state.pairIndex];

  // 每组随机决定上下顺序，消除位置惯性
  const flip = Math.random() < 0.5;
  const top = flip ? b : a;
  const bottom = flip ? a : b;
  // 注意：flip 必须在本组首次渲染时确定并缓存，否则重渲染会跳位

  const progress = (state.pairIndex / state.pairs.length) * 100;

  return `
    <div class="duel">
      <div class="bar"><i style="width:${progress}%"></i></div>
      <p class="count">第 ${state.pairIndex + 1} / ${state.pairs.length} 对</p>

      <div class="cards" role="group" aria-label="选择更像你的一项">
        ${card(top, 'a')}
        <p class="or">或</p>
        ${card(bottom, 'a')}
      </div>

      <button class="skip" data-act="pick" data-id="none">都不像我</button>
    </div>`;
}

function card(id, slot) {
  const t = getTalent(id);
  return `
    <button class="card" data-act="pick" data-id="${slot}" data-tid="${id}">
      <span class="card-q">${t.q}</span>
      <span class="card-n">${t.name}</span>
    </button>`;
}
```

**位置随机的实现要点**：`flip` 必须在进入该组时算一次并存入 `state`（如 `state.flip`），不能每次 `render()` 重算，否则点击后的重渲染会让卡片位置跳变，用户会以为自己点错了。

```js
// 在 pairIndex 变化时计算
state.flip = state.flipByPair[state.pairIndex] ??= Math.random() < 0.5;
```

### 7.4 雷达图 SVG

```js
function radarSVG(scores, size = 320) {
  const cx = size / 2, cy = size / 2, R = size * 0.38;
  const AXES = [
    { k:'S', label:'洞察', deg:-90 },
    { k:'E', label:'落地', deg:  0 },
    { k:'R', label:'连接', deg: 90 },
    { k:'I', label:'推动', deg:180 }
  ];
  const rad = d => d * Math.PI / 180;
  const pt  = (deg, ratio) => [
    cx + R * ratio * Math.cos(rad(deg)),
    cy + R * ratio * Math.sin(rad(deg))
  ];

  // 网格：5 圈
  let grid = '';
  for (let i = 1; i <= 5; i++) {
    const r = i / 5;
    const pts = AXES.map(a => pt(a.deg, r).join(',')).join(' ');
    grid += `<polygon points="${pts}" fill="none"
              stroke="#EBE4D4" stroke-width="0.5"/>`;
  }

  // 轴线
  let spokes = '';
  AXES.forEach(a => {
    const [x, y] = pt(a.deg, 1);
    spokes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"
                stroke="#EBE4D4" stroke-width="0.5"/>`;
  });

  // 数据多边形
  const dps = AXES.map(a => pt(a.deg, scores[a.k] / 100));
  const dataPath = dps.map(p => p.join(',')).join(' ');

  // 顶点
  const dots = dps.map(p =>
    `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#1D6F5C"/>`).join('');

  // 标签
  const labels = AXES.map(a => {
    const [lx, ly] = pt(a.deg, 1.22);
    const anchor = a.deg === 0 ? 'start'
                 : a.deg === 180 ? 'end' : 'middle';
    const dy = a.deg === -90 ? -12 : (a.deg === 90 ? 16 : 4);
    return `<text x="${lx}" y="${ly + dy}" text-anchor="${anchor}"
              font-size="13" fill="#6E6A62">${a.label}</text>
            <text x="${lx}" y="${ly + dy + 16}" text-anchor="${anchor}"
              font-size="11" fill="#2B2B28"
              font-family="var(--font-num)">${scores[a.k]}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${size} ${size}" class="radar"
            role="img" aria-label="四大域得分雷达图">
    ${grid}${spokes}
    <polygon points="${dataPath}" fill="#1D6F5C" fill-opacity="0.14"
      stroke="#1D6F5C" stroke-width="1.5" stroke-linejoin="round"/>
    ${dots}${labels}
  </svg>`;
}
```

**为什么 R 取 0.38 而不是 0.42**：标签需要放在顶点外侧，占比太大时「洞察」两个字会顶到画布边缘被裁切。

### 7.5 Canvas 结果卡

```js
async function saveImage() {
  const W = 1080, H = 1440;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // 底
  g.fillStyle = '#F5F1E8';
  g.fillRect(0, 0, W, H);

  const F = (w, s, fam) =>
    `${w} ${s}px ${fam || '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'}`;

  // 品牌行
  g.fillStyle = '#6E6A62';
  g.font = F(400, 26);
  g.textAlign = 'left';
  g.fillText('知时  KAIROS', 80, 110);

  // 原型名（居中，大字）
  g.textAlign = 'center';
  g.fillStyle = '#1A1A18';
  g.font = F(500, 120);
  g.fillText(state.result.arch.name, W / 2, 300);

  // 代码
  g.fillStyle = '#C4643C';
  g.font = F(500, 36);
  g.fillText(state.result.arch.code, W / 2, 370);

  // 装饰线
  g.fillStyle = '#C4643C';
  g.fillRect(W / 2 - 40, 410, 80, 3);

  // 画像（两行折行）
  g.fillStyle = '#6E6A62';
  g.font = F(400, 32);
  wrapText(g, state.result.arch.img, W / 2, 480, 760, 48);

  // 雷达图（重绘矢量，不用截图）
  drawRadarOnCanvas(g, state.result.scores, W / 2, 870, 230);

  // 前 5（两列）
  g.textAlign = 'left';
  state.result.top5.forEach((id, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 110 + col * 440, y = 1200 + row * 70;
    g.fillStyle = '#A9A499';
    g.font = F(400, 26);
    g.fillText(String(i + 1).padStart(2, '0'), x, y);
    g.fillStyle = '#1A1A18';
    g.font = F(500, 34);
    g.fillText(getTalent(id).name, x + 56, y);
  });

  // 卡点（作为分享钩子，必须留）
  g.textAlign = 'center';
  g.fillStyle = '#C4643C';
  g.font = F(400, 30);
  g.fillText(state.result.arch.pit, W / 2, 1385);

  // 水印
  g.fillStyle = '#A9A499';
  g.font = F(400, 24);
  g.fillText('知时 Kairos ｜ 抖音 @TR_及时雨', W / 2, 1420);

  const url = c.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `知时才干罗盘_${state.result.arch.name}.png`;
  a.click();
}
```

**iOS Safari 注意**：`<a download>` 在部分 iOS 版本会打开新标签而非下载。降级方案：检测失败后提示「长按图片保存」，并把 dataURL 渲染进一个 `<img>`。

**中文折行**：Canvas 没有自动折行，必须手写 `wrapText`，按字符宽度累积换行。不能按空格拆——中文没有空格。

### 7.6 分享编码

```js
function encodeResult(r) {
  const payload = {
    v: 1,
    o: r.top5.map(id => getTalent(id).name),      // 存名字而非 id，便于阅读与容错
    s: [r.scores.S, r.scores.E, r.scores.R, r.scores.I],
    t: r.arch.code
  };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeResult(hash) {
  const m = hash.match(/#r=(.+)$/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    const p = JSON.parse(json);
    if (p.v !== 1 || !Array.isArray(p.o) || p.o.length !== 5) return null;
    if (!Array.isArray(p.s) || p.s.length !== 4) return null;
    if (typeof p.t !== 'string') return null;
    return p;
  } catch (e) { return null; }
}
```

**为什么用 `unescape(encodeURIComponent())`**：`btoa` 只接受 Latin-1 字符，直接传中文会抛 `InvalidCharacterError`。这个组合把字符串转成 UTF-8 字节序列再编码。`unescape` 已废弃但所有浏览器仍支持，是当前体积最小的写法。

**长度估算**：34 项里最长的 5 个名字约 15 个汉字 = 45 字节，加结构与数字约 80 字节，合计约 125 字节 → base64 后约 170 字符。加上域名总长 < 300 字符，任何平台都能安全分享。

**解码后的兼容**：`o` 存的是名字不是 id，所以即使将来调整 id 命名，旧链接仍可读。代价是无法反查 id，需要在渲染时按名字反查。

---

## 8. 性能预算

| 指标 | 预算 | 测量方式 |
|---|---|---|
| 首屏可交互 | < 500ms（本地文件） | Lighthouse / 手动计时 |
| 单次作答→下一题 | < 100ms | Performance.now() |
| 结果页渲染 | < 300ms | 同上 |
| 图片生成 | < 1000ms | 同上 |
| 单文件体积 | < 250KB | 含二维码 base64 |
| 内存占用 | < 30MB | Chrome DevTools |

### 体积分配

| 部分 | 预估 |
|---|---|
| HTML 骨架 + CSS | 25KB |
| 34 项数据 | 12KB |
| 32 套文案 | 18KB |
| 建议库 + 预警库 | 15KB |
| 逻辑代码 | 30KB |
| 二维码 base64 | 115KB（PNG 86KB） |
| **合计** | **约 215KB** |

**二维码优化**：若体积超标，把二维码转 PNG-8（8 位调色板）+ 缩至 360 宽，可降到约 35KB，base64 后 47KB，总体积降到 147KB。

```python
# 优化脚本
from PIL import Image
im = Image.open('douyin_qr.png').convert('L').resize((360, 537), Image.LANCZOS)
im = im.convert('P', palette=Image.ADAPTIVE, colors=16)
im.save('qr_p8.png', optimize=True)
```

---

## 9. 兼容性与降级

| 能力 | 检测 | 降级 |
|---|---|---|
| localStorage | try/catch 探测 | 内存态 + 顶部提示条 |
| clipboard API | `navigator.clipboard` | `execCommand('copy')` |
| Canvas | `!!document.createElement('canvas').getContext` | 隐藏「保存图片」 |
| `dvh` 单位 | CSS `@supports (height: 100dvh)` | 回退 `100vh` |
| `backdrop-filter` | 不使用 | — |
| `:has()` | 不使用 | — |
| `Array.at()` | 不使用 | 用索引 |
| `structuredClone` | 不使用 | `JSON.parse(JSON.stringify())` |

### 微信内置浏览器专项

| 问题 | 处理 |
|---|---|
| 长按识别二维码 | 图片必须是 `<img>` 真实 DOM，不能用 CSS background |
| 下载 PNG 被拦 | 改为弹出预览图 + 提示「长按保存」 |
| 分享链接被截断 | 控制 URL 长度 < 400 字符 |
| 返回键行为 | 不拦截，允许退出 |

---

## 10. 错误处理

| 场景 | 处理 | 用户感知 |
|---|---|---|
| 配对时 queue 为空 | 断言 + 返回开场页 | 「数据异常，请重新开始」 |
| pairIndex 越界 | 断言 + 强制 endRound | 无感 |
| 解码失败 | 忽略参数 | 正常开场 |
| Canvas 抛错 | try/catch | 「保存失败，可长按截图」 |
| 存储写入失败 | 静默，切内存态 | 顶部提示「本次结果不会保存」 |
| 五强不足 5 项 | 从淘汰项按分数补足 | 无感 |

**原则**：任何异常都不能白屏。最差情况是回到开场页重新开始。

---

## 11. 测试要点

### 11.1 引擎单元测试

| 用例 | 输入 | 期望 |
|---|---|---|
| T-01 | 34 项 | 17 组，无轮空 |
| T-02 | 17 项 | 8 组，1 轮空 |
| T-03 | 18 项 | 9 组，无轮空 |
| T-04 | 9 项 | 4 组，1 轮空 |
| T-05 | 10 项 | 5 组，无轮空 |
| T-06 | 全选 A | 17 项晋级，无重复 |
| T-07 | 全选"都不像" | 第 1 轮 0 项晋级 |
| T-08 | 捞回后 | 人数 +1，无重复项 |
| T-09 | 重复捞同一项 | 被拒绝 |
| T-10 | 单域 4 项 | 判为单域型 |
| T-11 | S3 R2 | 判为 S·R |
| T-12 | S2 R2，Top1 在 R | 判为 R·S |
| T-13 | 域分计算 | 等于域内平均，取整 |

### 11.2 交互测试

| 用例 | 操作 | 期望 |
|---|---|---|
| I-01 | 快速连点同一卡 | 只计一次 |
| I-02 | 对决中刷新 | 回到该组开头 |
| I-03 | 对决中关闭浏览器再开 | 断点续上 |
| I-04 | 结果页刷新 | 结果保留 |
| I-05 | 点「重新测一次」 | 二次确认后清空 |

### 11.3 兼容测试矩阵

| 设备 / 浏览器 | 必测项 |
|---|---|
| iPhone SE (375×667) | 对决页无滚动、卡片不溢出 |
| iPhone 14 Pro (393×852) | 安全区适配 |
| Android 中端机 (360×800) | 字体渲染、Canvas 出图 |
| 微信 iOS | 二维码长按识别、分享链接 |
| 微信 Android | 同左 |
| Chrome 桌面 | 布局居中、键盘操作 |
| Safari 桌面 | Canvas 下载 |
| 无网络 | 全流程可用 |

### 11.4 数据完整性

| 检查 | 方法 |
|---|---|
| 34 项字段齐全 | 启动时遍历断言 |
| 16 型齐全 | 遍历 ARCHETYPES 键 |
| 32 套文案齐全 | 断言 16×2 全覆盖 |
| 二维码可扫 | 手机实扫 3 次 |

---

## 12. 文件组织

开发阶段可分文件，交付时合并为单文件。

```
src/
├── data/
│   ├── talents.js       34 项
│   ├── archetypes.js    16 型
│   ├── descriptions.js  32 套
│   ├── advice.js        16 条
│   ├── drain.js         34 条
│   └── qr.js            二维码 base64
├── core/
│   ├── engine.js        配对 / 晋级 / 捞回 / 定序
│   ├── score.js         计分 / 原型 / 文案选取
│   └── store.js         持久化
├── ui/
│   ├── view-intro.js
│   ├── view-duel.js
│   ├── view-rescue.js
│   ├── view-order.js
│   ├── view-result.js
│   ├── radar.js         SVG 生成
│   └── canvas-card.js   结果卡
├── app.js               控制器
└── style.css

build.py                 合并为 index.html
```

**合并脚本**：按依赖顺序拼接，去掉 `import/export`，包进 IIFE。

```python
# build.py 核心逻辑
ORDER = ['data/talents.js', 'data/archetypes.js', ..., 'ui/radar.js', 'app.js']
parts = [open(f'./src/{p}', encoding='utf-8').read() for p in ORDER]
open('./index.html', 'w', encoding='utf-8').write(
    HTML_HEAD + '<style>' + css + '</style>'
    + '<div id="app"></div><script>(function(){'
    + '\n'.join(parts) + '})();</script>'
)
```

---

## 13. 开发顺序建议

按"可验证性"排序，每一步都能独立跑通：

| 步 | 内容 | 验证方式 |
|---|---|---|
| 1 | DATA 的 34 项 | 控制台打印长度 = 34，四域各 8–9 |
| 2 | ENGINE 全流程（无界面） | 控制台跑一遍，输出 5 强名单 |
| 3 | 对决视图 | 能点完 34 项 |
| 4 | 结果页骨架 | 看到前 5 和原型名 |
| 5 | 雷达图 | 四轴形状正确 |
| 6 | 32 套文案 | 换不同分布，看描述是否对得上 |
| 7 | 存储 | 刷新续上 |
| 8 | 分享 + 出图 | 手机上真机验证 |
| 9 | 视觉打磨 | 对照 UI 文档逐项核对 |

**不建议先做界面再补逻辑**：这个产品的核心是赛制，界面只是赛制的外壳。先把引擎跑通，后面所有界面工作都是确定的。
