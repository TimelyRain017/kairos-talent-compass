/* 自动通关 + 屏幕录制
   用法：
     node tests/record.js probe        只跑逻辑，不录，打印每个种子的结果
     node tests/record.js rec <seed>   用指定种子正式录制
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9444;
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cdp(ws){
  let id = 0;
  const waits = new Map();
  const events = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)){ waits.get(m.id)(m); waits.delete(m.id); }
    else if (m.method) events.push(m);
  });
  return {
    send(method, params){
      return new Promise((res, rej) => {
        const i = ++id;
        waits.set(i, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
        ws.send(JSON.stringify({ id: i, method, params: params || {} }));
      });
    },
    on(handler){ ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method) handler(m); }); }
  };
}

async function waitPort(){
  for (let i = 0; i < 60; i++){
    try{ const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; }catch(e){}
    await sleep(200);
  }
  throw new Error('CDP 端口没起来');
}

/* ===== 页面内脚本：计划通关 ===== */
const PLAYER = `
window.__PLAY__ = async function(opt){
  opt = opt || {};
  var K = window.__KAIROS__, S = K.state;
  var T = function(id){ return K.getTalent(id); };
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

  /* 固定随机数：种子相同 -> 配对完全相同，方便先试探再录 */
  var m = (opt.seed || 1) >>> 0;
  Math.random = function(){
    m = m + 0x6D2B79F5 | 0;
    var t = Math.imul(m ^ m >>> 15, 1 | m);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  K.start();

  var quota = {R:7, S:6};
  var round3 = null;

  function bump(c, d){ if (d==='R') c.R++; else if (d==='S') c.S++; else c.X++; }
  function has(pair, d){ return T(pair[0]).d===d || T(pair[1]).d===d; }

  /* 第三轮：枚举 2^n 种选法，只要最终 3R+2S（含轮空） */
  function planRound3(){
    var pairs = S.pairs, n = pairs.length, bye = S.bye;
    for (var mask = 0; mask < (1 << n); mask++){
      var c = {R:0,S:0,X:0};
      if (bye) bump(c, T(bye).d);
      for (var i = 0; i < n; i++) bump(c, T(pairs[i][(mask >> i & 1) ? 1 : 0]).d);
      if (c.R === 3 && c.S === 2) return mask;
    }
    return -1;
  }

  /* 第一、二轮：按配额贪心，优先留 R，再留 S */
  function chooseWithQuota(pair){
    var a = T(pair[0]), b = T(pair[1]);
    if (a.d==='R' && quota.R>0){ quota.R--; return 'a'; }
    if (b.d==='R' && quota.R>0){ quota.R--; return 'b'; }
    if (a.d==='S' && quota.S>0){ quota.S--; return 'a'; }
    if (b.d==='S' && quota.S>0){ quota.S--; return 'b'; }
    if (a.d!=='R' && a.d!=='S') return 'a';
    if (b.d!=='R' && b.d!=='S') return 'b';
    return 'a';
  }

  async function pause(ms){ if (opt.slow) await sleep(ms); }

  while (S.stage !== 'order'){
    if (S.stage === 'duel'){
      if (S.round === 3 && !round3){ round3 = planRound3(); if (round3 < 0) return {ok:false, why:'第三轮无解'}; }
      var pair = S.pairs[S.pairIndex];
      var choice = (S.round === 3) ? ((round3 >> S.pairIndex & 1) ? 'b' : 'a') : chooseWithQuota(pair);
      await pause(opt.pace || 520);
      K.resolvePair(choice);
      await pause(120);
      if (S.stage === 'roundEnd'){
        await sleep(opt.slow ? 1400 : 0);
        K.gotoRescue();
        await sleep(opt.slow ? 1900 : 0);
        K.doRescue(null);
        if (S.round === 2) quota = {R:4, S:3};
        await pause(500);
      }
    } else if (S.stage === 'rescue'){
      K.doRescue(null);
    } else break;
  }

  /* 定序：先点 R，让 Top1 落在连接域 */
  var pool = S.orderPool.slice();
  pool.sort(function(x,y){
    var w = {R:0,S:1,E:2,I:3};
    return (w[T(x).d]-w[T(y).d]) || (T(x).id > T(y).id ? 1 : -1);
  });
  for (var i = 0; i < pool.length - 1; i++){
    await pause(opt.slow ? 620 : 0);
    K.pickFirst(pool[i]);
    await pause(80);
  }

  var r = S.result;
  return {
    ok: !!r,
    code: r && r.arch.code,
    name: r && (K.ARCHETYPES[r.arch.code] || {}).name,
    top5: r && r.top5.map(function(id){ var t=T(id); return t.name+'('+t.d+')'; }),
    dom: r && r.dom,
    firstDomain: r && T(r.top5[0]).d,
    scores: r && r.top5.map(function(id){ return r.item[id]; })
  };
};
`;

(async () => {
  const mode = process.argv[2] || 'probe';
  const cp = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=3',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/tmp/chr_rec_' + Date.now()], { stdio: 'ignore' });

  try{
    await waitPort();
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const { send, on } = cdp(ws);

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true
    });
    await send('Page.navigate', { url: 'file:///' + path.join(ROOT, '才干罗盘_MVP2.html').replace(/\\/g, '/') });
    for (let i = 0; i < 40; i++){
      await sleep(150);
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r.result && r.result.value === 'complete') break;
    }
    await sleep(900);
    await send('Runtime.evaluate', { expression: 'try{window.__KAIROS__.closeGuide()}catch(e){}' });
    await sleep(400);
    await send('Runtime.evaluate', { expression: PLAYER });

    if (mode === 'probe'){
      for (const seed of [1,2,3,4,5,6,7,8]){
        const r = await send('Runtime.evaluate', {
          expression: `(async()=>{document.querySelectorAll('.guide').forEach(n=>n.remove());return await window.__PLAY__({seed:${seed},slow:false});})()`,
          awaitPromise: true, returnByValue: true
        });
        if (r.exceptionDetails) console.log('seed ' + seed + ' 异常:', JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0,300));
        const v = r.result.value || {};
        console.log(`seed ${seed}: ${v.ok ? v.code + ' ' + v.name : '失败 ' + (v.why||'')}  ${v.top5 ? v.top5.join(',') : ''}`);
      }
    } else {
      const seed = parseInt(process.argv[3] || '1', 10);
      /* 录像：先摆一个安静的开场 */
      await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' });
      await sleep(900);

      const frames = [];
      on(m => {
        if (m.method === 'Page.screencastFrame'){
          frames.push({ data: m.params.data, ts: m.params.metadata.timestamp });
          ws.send(JSON.stringify({ id: 900000 + frames.length, method: 'Page.screencastFrameAck',
            params: { sessionId: m.params.sessionId } }));
        }
      });
      await send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 1170, maxHeight: 2532, everyNthFrame: 1 });
      await sleep(2600);   /* 首页停留 */

      const r = await send('Runtime.evaluate', {
        expression: `(async()=>{return await window.__PLAY__({seed:${seed},slow:true,pace:560});})()`,
        awaitPromise: true, returnByValue: true
      });
      const info = r.result.value;
      console.log('结果：', JSON.stringify(info, null, 1));

      /* 结果页慢慢往下看，一直到底 */
      const maxY = (await send('Runtime.evaluate', {
        expression: 'Math.max(0, document.documentElement.scrollHeight - window.innerHeight)',
        returnByValue: true })).result.value;
      const steps = 10;
      for (let i = 1; i <= steps; i++){
        await send('Runtime.evaluate', { expression: `window.scrollTo({top:${Math.round(maxY * i / steps)},behavior:'smooth'})` });
        await sleep(700);
      }
      await sleep(3000);   /* 结尾停留 */

      await send('Page.stopScreencast');
      await sleep(300);

      /* 写帧 + 拼视频 */
      const dir = path.join(ROOT, 'video_frames');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
      const list = [];
      for (let i = 0; i < frames.length; i++){
        const p = path.join(dir, 'f' + String(i).padStart(4, '0') + '.jpg');
        fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'));
        const next = frames[i + 1];
        const dur = next ? Math.max(1 / 60, next.ts - frames[i].ts) : 0.6;
        list.push(`file '${p.replace(/\\/g, '/')}'\nduration ${dur.toFixed(4)}`);
      }
      list.push(`file '${path.join(dir, 'f' + String(frames.length - 1).padStart(4, '0') + '.jpg').replace(/\\/g, '/')}'`);
      const listFile = path.join(dir, 'list.txt');
      fs.writeFileSync(listFile, list.join('\n'), 'utf8');
      const total = frames.length ? (frames[frames.length - 1].ts - frames[0].ts) : 0;
      console.log(`帧数 ${frames.length}，时长约 ${total.toFixed(1)} 秒`);
      fs.writeFileSync(path.join(ROOT, 'video_frames', 'meta.json'), JSON.stringify({ frames: frames.length, seconds: total, info }, null, 1));
    }

    ws.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
  } finally {
    cp.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
