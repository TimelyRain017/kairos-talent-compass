/* 分享页截图：先用固定种子跑出一份真实结果（倾听者 R·S），
   编码进 URL hash，模拟「别人打开分享链接」看到的样子，再截图 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, '才干罗盘_MVP2.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cdp(ws){
  let id = 0;
  const waits = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)){ waits.get(m.id)(m); waits.delete(m.id); }
  });
  return function send(method, params){
    return new Promise((res, rej) => {
      const i = ++id;
      waits.set(i, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  };
}

async function waitPort(){
  for (let i = 0; i < 60; i++){
    try{ const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return await r.json(); }catch(e){}
    await sleep(200);
  }
  throw new Error('CDP 端口没起来');
}

/* 在页面里用固定种子跑完整流程，返回编码后的分享码 */
const RUN_JS = `(function(){
  var K = window.__KAIROS__;
  var T = function(id){ return K.getTalent(id); };

  /* 固定随机数：seed 1 → 包容/积极/识人/思维/学习（倾听者 R·S），与视频一致 */
  var m = 1 >>> 0;
  Math.random = function(){
    m = m + 0x6D2B79F5 | 0;
    var t = Math.imul(m ^ m >>> 15, 1 | m);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  function bump(c, d){ if (d === 'R') c.R++; else if (d === 'S') c.S++; else c.X++; }
  function choose(pair, quota){
    var a = T(pair[0]), b = T(pair[1]);
    if (a.d === 'R' && quota.R > 0){ quota.R--; return 'a'; }
    if (b.d === 'R' && quota.R > 0){ quota.R--; return 'b'; }
    if (a.d === 'S' && quota.S > 0){ quota.S--; return 'a'; }
    if (b.d === 'S' && quota.S > 0){ quota.S--; return 'b'; }
    if (a.d !== 'R' && a.d !== 'S') return 'a';
    if (b.d !== 'R' && b.d !== 'S') return 'b';
    return 'a';
  }
  function planRound3(S){
    var pairs = S.pairs, n = pairs.length, bye = S.bye;
    for (var mask = 0; mask < (1 << n); mask++){
      var c = { R:0, S:0, X:0 };
      if (bye) bump(c, T(bye).d);
      for (var i = 0; i < n; i++) bump(c, T(pairs[i][(mask >> i & 1) ? 1 : 0]).d);
      if (c.R === 3 && c.S === 2) return mask;
    }
    return -1;
  }

  try { K.closeGuide(); } catch(e){}
  K.start();

  var quota = { R:7, S:6 }, curRound = 0, r3 = null, guard = 0;
  while (guard++ < 500){
    var S = K.state;
    if (S.round !== curRound){
      curRound = S.round;
      if (S.round === 1) quota = { R:7, S:6 };
      else if (S.round === 2) quota = { R:4, S:3 };
    }
    if (S.stage === 'duel'){
      if (S.round === 3){
        if (r3 === null) r3 = planRound3(S);
        if (r3 < 0) return { ok:false, why:'第三轮无解' };
      }
      var pair = S.pairs[S.pairIndex];
      K.resolvePair(S.round === 3 ? ((r3 >> S.pairIndex & 1) ? 'b' : 'a') : choose(pair, quota));
    } else if (S.stage === 'roundEnd'){
      K.gotoRescue();
    } else if (S.stage === 'rescue'){
      K.doRescue(null);
    } else if (S.stage === 'order'){
      var w = { R:0, S:1, E:2, I:3 };
      var pool = S.orderPool.slice().sort(function(x, y){
        return (w[T(x).d] - w[T(y).d]) || (x > y ? 1 : -1);
      });
      K.pickFirst(pool[0]);
    } else if (S.stage === 'result'){
      var r = S.result;
      var code = K.encodeResult(r);
      return { ok:true, code:code,
        arch:r.arch.code, name:(K.ARCHETYPES[r.arch.code] || {}).name,
        top5:r.top5.map(function(id){ return T(id).name; }),
        dom:r.dom, share:K.shareURL() };
    }
  }
  return { ok:false, why:'流程没走完，停在 ' + K.state.stage };
})()`;

(async () => {
  const cp = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/tmp/chr_share_' + Date.now()], { stdio: 'ignore' });

  const outDir = path.join(ROOT, 'shots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  try{
    await waitPort();

    /* ---- 第一步：跑出真实结果，拿到分享码 ---- */
    const t0 = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws0 = new WebSocket(t0.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws0.addEventListener('open', r); ws0.addEventListener('error', j); });
    const s0 = cdp(ws0);
    await s0('Page.enable');
    await s0('Emulation.setDeviceMetricsOverride', { width:1440, height:1080, deviceScaleFactor:1, mobile:false });
    await s0('Page.navigate', { url: PAGE });
    for (let i = 0; i < 40; i++){
      await sleep(150);
      const r = await s0('Runtime.evaluate', { expression:'document.readyState', returnByValue:true });
      if (r.result && r.result.value === 'complete') break;
    }
    await sleep(600);
    const run = await s0('Runtime.evaluate', { expression: RUN_JS, returnByValue:true });
    if (run.exceptionDetails){
      throw new Error('跑流程异常: ' + ((run.exceptionDetails.exception || {}).description || run.exceptionDetails.text));
    }
    const info = run.result.value;
    if (!info || !info.ok) throw new Error('跑流程失败: ' + JSON.stringify(info));
    console.log('结果:', info.name, info.arch, '| Top5:', info.top5.join(','), '| 域:', JSON.stringify(info.dom));
    console.log('分享码:', info.code);
    ws0.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t0.id}`);

    const SHARE = PAGE + '#r=' + info.code;
    fs.writeFileSync(path.join(ROOT, 'shots', 'share_url.txt'), SHARE, 'utf8');

    /* ---- 第二步：按分享链接打开，截图 ---- */
    const shots = [
      { name:'share_pc_top.png',    w:1440, h:1080, mobile:false, full:false },
      { name:'share_pc_full.png',   w:1440, h:1080, mobile:false, full:true  },
      { name:'share_m_top.png',     w:390,  h:844,  mobile:true,  full:false },
      { name:'share_m_full.png',    w:390,  h:844,  mobile:true,  full:true  }
    ];

    for (const sh of shots){
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
      const send = cdp(ws);

      await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', {
        width: sh.w, height: sh.h, deviceScaleFactor: 1, mobile: sh.mobile
      });
      await send('Page.navigate', { url: SHARE });
      for (let i = 0; i < 40; i++){
        await sleep(150);
        const r = await send('Runtime.evaluate', { expression:'document.readyState', returnByValue:true });
        if (r.result && r.result.value === 'complete') break;
      }
      await sleep(1500);   /* 等字体与雷达图动画落位 */

      /* 确认真的进了分享视图 */
      const chk = await send('Runtime.evaluate', {
        expression: 'JSON.stringify({share:!!document.querySelector(".share-banner"),h:document.body.scrollHeight})',
        returnByValue: true });
      const info2 = JSON.parse(chk.result.value);
      console.log('  ' + sh.name + ' 分享横幅:' + info2.share + ' 页高:' + info2.h);

      if (sh.full){
        const met = await send('Page.getLayoutMetrics');
        const cs = met.cssContentSize || met.contentSize;
        const cap = await send('Page.captureScreenshot', {
          format:'png', captureBeyondViewport:true,
          clip:{ x:0, y:0, width: sh.w, height: Math.ceil(cs.height), scale:1 }
        });
        fs.writeFileSync(path.join(outDir, sh.name), Buffer.from(cap.data, 'base64'));
      } else {
        const cap = await send('Page.captureScreenshot', { format:'png' });
        fs.writeFileSync(path.join(outDir, sh.name), Buffer.from(cap.data, 'base64'));
      }
      console.log('  shot →', sh.name);

      ws.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
    }
  } finally {
    cp.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
