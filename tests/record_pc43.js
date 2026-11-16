/* 网页版（PC 布局）+ 4:3 画幅 + 真实鼠标动作录制
   用法：
     node tests/record_pc43.js probe           只跑逻辑，不录，打印每个种子的结果
     node tests/record_pc43.js rec <seed>      用指定种子录制 4:3 素材

   与旧版 record.js 的区别：
   1. 视口 1024×768（4:3），mobile:false → 触发 @media(min-width:769px) 的 PC 布局
   2. 所有交互走 CDP Input.dispatchMouseEvent（move / press / release / wheel），
      而不是直接调用内部函数，页面收到的是真实事件，:active 与点击反馈都会走一遍
   3. 页面内注入一枚跟随光标的圆点，用 rAF 插值做平滑移动，点击时有缩放与涟漪，
      这样帧里能看见"手指落在哪里"
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9446;
const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, '才干罗盘_MVP2.html');

/* 4:3 —— 视口直接取 1440×1080。
   注意：Page.startScreencast 的 maxWidth 会被 layout viewport 夹住，
   调 deviceScaleFactor 不会放大录屏帧，所以直接放大视口拿分辨率。 */
const VW = 1440, VH = 1080, DSF = 1;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

function cdp(ws){
  let id = 0;
  const waits = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)){ waits.get(m.id)(m); waits.delete(m.id); }
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

/* ============ 注入：跟随光标的圆点 ============ */
const CURSOR_JS = `
(function(){
  if (window.__CURSOR__) return 'exists';
  var dot=document.createElement('div');
  dot.id='simDot';
  dot.style.cssText=[
    'position:fixed','left:0','top:0','width:28px','height:28px',
    'margin:-14px 0 0 -14px','border-radius:50%',
    'background:rgba(20,38,48,.86)',
    'box-shadow:0 0 0 2.5px rgba(255,255,255,.95),0 4px 12px rgba(0,0,0,.3)',
    'pointer-events:none','z-index:2147483000',
    'transform:translate3d(-200px,-200px,0)',
    'transition:width .09s ease,height .09s ease,margin .09s ease,background .09s ease',
    'will-change:transform'
  ].join(';');
  document.body.appendChild(dot);

  var ring=document.createElement('div');
  ring.id='simRing';
  ring.style.cssText=[
    'position:fixed','left:0','top:0','width:28px','height:28px',
    'margin:-14px 0 0 -14px','border-radius:50%',
    'border:2px solid rgba(20,38,48,.5)','opacity:0',
    'pointer-events:none','z-index:2147482999',
    'transform:translate3d(-200px,-200px,0) scale(.5)'
  ].join(';');
  document.body.appendChild(ring);

  var x=-200,y=-200,tx=-200,ty=-200,raf=null;

  function loop(){
    x+=(tx-x)*0.26; y+=(ty-y)*0.26;
    if(Math.abs(tx-x)<0.35 && Math.abs(ty-y)<0.35){ x=tx; y=ty; }
    dot.style.transform='translate3d('+x+'px,'+y+'px,0)';
    raf = (x!==tx || y!==ty) ? requestAnimationFrame(loop) : null;
  }
  function kick(){ if(!raf) raf=requestAnimationFrame(loop); }

  window.__CURSOR__={
    to:function(nx,ny){ tx=nx; ty=ny; kick(); },
    down:function(){
      dot.style.width='19px'; dot.style.height='19px'; dot.style.margin='-9.5px 0 0 -9.5px';
      dot.style.background='rgba(196,100,60,.95)';
    },
    up:function(){
      dot.style.width='28px'; dot.style.height='28px'; dot.style.margin='-14px 0 0 -14px';
      dot.style.background='rgba(20,38,48,.86)';
    },
    ping:function(){
      ring.style.transition='none';
      ring.style.transform='translate3d('+tx+'px,'+ty+'px,0) scale(.45)';
      ring.style.opacity='.85';
      requestAnimationFrame(function(){
        ring.style.transition='opacity .5s cubic-bezier(.2,.7,.3,1),transform .5s cubic-bezier(.2,.7,.3,1)';
        ring.style.transform='translate3d('+tx+'px,'+ty+'px,0) scale(2.6)';
        ring.style.opacity='0';
      });
    }
  };
  return 'ok';
})();
`;

/* ============ 注入：每一步该点哪里（只做决策，不执行点击） ============ */
const SIM_JS = `
(function(){
  var K=window.__KAIROS__;
  var T=function(id){ return K.getTalent(id); };

  var sim={
    quota:{R:7,S:6},
    round3:null,
    curRound:0,
    armed:false
  };

  /* 固定随机数：种子相同 → 配对完全相同，可以先试探再录 */
  sim.arm=function(seed){
    var m=(seed||1)>>>0;
    Math.random=function(){
      m=m+0x6D2B79F5|0;
      var t=Math.imul(m^m>>>15,1|m);
      t=t+Math.imul(t^t>>>7,61|t)^t;
      return ((t^t>>>14)>>>0)/4294967296;
    };
    sim.armed=true;
    sim.quota={R:7,S:6};
    sim.round3=null;
    return true;
  };

  function has(pair,d){ return T(pair[0]).d===d || T(pair[1]).d===d; }
  function bump(c,d){ if(d==='R')c.R++; else if(d==='S')c.S++; else c.X++; }

  /* 第三轮：枚举 2^n 种选法，只要最终 3R+2S（含轮空） */
  function planRound3(S){
    var pairs=S.pairs,n=pairs.length,bye=S.bye;
    for(var mask=0;mask<(1<<n);mask++){
      var c={R:0,S:0,X:0};
      if(bye) bump(c,T(bye).d);
      for(var i=0;i<n;i++) bump(c,T(pairs[i][(mask>>i&1)?1:0]).d);
      if(c.R===3&&c.S===2) return mask;
    }
    return -1;
  }

  /* 第一、二轮：按配额贪心，优先留 R，再留 S */
  function chooseWithQuota(pair){
    var a=T(pair[0]),b=T(pair[1]);
    if(a.d==='R'&&sim.quota.R>0){ sim.quota.R--; return 'a'; }
    if(b.d==='R'&&sim.quota.R>0){ sim.quota.R--; return 'b'; }
    if(a.d==='S'&&sim.quota.S>0){ sim.quota.S--; return 'a'; }
    if(b.d==='S'&&sim.quota.S>0){ sim.quota.S--; return 'b'; }
    if(a.d!=='R'&&a.d!=='S') return 'a';
    if(b.d!=='R'&&b.d!=='S') return 'b';
    return 'a';
  }

  /* 返回下一步：{sel} 需要点击 / {wait} 纯等待 / {done} 结束 */
  sim.next=function(){
    var S=K.state;
    /* 进入新一轮时切换配额：第 1 轮留 7R+6S，第 2 轮留 4R+3S */
    if(S.round!==sim.curRound){
      sim.curRound=S.round;
      if(S.round===1) sim.quota={R:7,S:6};
      else if(S.round===2) sim.quota={R:4,S:3};
    }
    if(S.stage==='duel'){
      if(S.round===3 && sim.round3===null){
        sim.round3=planRound3(S);
        if(sim.round3<0) return {error:'第三轮无解'};
      }
      var pair=S.pairs[S.pairIndex];
      var ch=(S.round===3) ? ((sim.round3>>S.pairIndex&1)?'b':'a') : chooseWithQuota(pair);
      return {sel:'[data-act="pick"][data-id="'+ch+'"]', tag:'pick'+ch.toUpperCase(), round:S.round, i:S.pairIndex};
    }
    if(S.stage==='roundEnd') return {sel:'[data-act="skipTrans"]', tag:'过渡', wait:400};
    if(S.stage==='rescue'){
      return {sel:'[data-act="skipRescue"]', tag:'跳过捞回'};
    }
    if(S.stage==='order'){
      var w={R:0,S:1,E:2,I:3};
      var pool=S.orderPool.slice().sort(function(x,y){
        return (w[T(x).d]-w[T(y).d]) || (x>y?1:-1);
      });
      return {sel:'[data-act="orderPick"][data-id="'+pool[0]+'"]', tag:'定序'};
    }
    if(S.stage==='result') return {done:true};
    return {sel:null, tag:'未知:'+S.stage};
  };

  sim.result=function(){
    var S=K.state, r=S.result;
    if(!r) return {ok:false};
    return {
      ok:true,
      code:r.arch.code,
      name:(K.ARCHETYPES[r.arch.code]||{}).name,
      top5:r.top5.map(function(id){ var t=T(id); return t.name+'('+t.d+')'; }),
      dom:r.dom,
      firstDomain:T(r.top5[0]).d
    };
  };

  window.__SIM__=sim;
  return 'ok';
})();
`;

(async () => {
  const mode = process.argv[2] || 'rec';
  const seed = parseInt(process.argv[3] || '1', 10);

  const cp = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/tmp/chr_pc_' + Date.now()], { stdio: 'ignore' });

  try{
    await waitPort();
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const { send, on } = cdp(ws);

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: VW, height: VH, deviceScaleFactor: DSF, mobile: false
    });
    await send('Page.navigate', { url: 'file:///' + PAGE.replace(/\\/g, '/') });
    for (let i = 0; i < 50; i++){
      await sleep(120);
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r.result && r.result.value === 'complete') break;
    }
    await sleep(1100);

    /* ===== 真实鼠标动作原语 ===== */
    const cursorTo = (x, y) => send('Runtime.evaluate', {
      expression: `window.__CURSOR__ && window.__CURSOR__.to(${x},${y})` });
    const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent',
      Object.assign({ type, x, y, button: 'left', clickCount: 1, modifiers: 0 }, extra || {}));

    /* 把光标移到元素上（带一点弧度，不像机器直线） */
    async function glideTo(x, y, pause){
      const mx = x + rnd(-70, 70), my = y + rnd(-50, 50);
      await cursorTo(Math.round(mx), Math.round(my));
      await mouse('mouseMoved', Math.round(mx), Math.round(my), { button: 'none' });
      await sleep(Math.round(rnd(70, 120)));
      await cursorTo(x, y);
      await mouse('mouseMoved', x, y, { button: 'none' });
      await sleep(pause === undefined ? Math.round(rnd(520, 640)) : pause);
    }

    /* 在某元素中心执行一次真实点击（元素可能刚渲染，轮询等它出现） */
    async function clickSel(sel, opt){
      opt = opt || {};
      let b = null;
      for (let attempt = 0; attempt < 14; attempt++){
        const q = await send('Runtime.evaluate', {
          expression: `(function(){var e=document.querySelector(${JSON.stringify(sel)});`
            + `if(!e)return null;var r=e.getBoundingClientRect();`
            + `if(r.width<1||r.height<1)return null;`
            + `return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,`
            + `hit:(function(p){var n=document.elementFromPoint(p.x,p.y);return !!(n&&e.contains(n));})({x:r.left+r.width/2,y:r.top+r.height/2})};})()`,
          returnByValue: true
        });
        b = q.result.value;
        if (b) break;
        await sleep(120);
      }
      if (!b){
        const snap = (await send('Runtime.evaluate', { returnByValue: true,
          expression: `JSON.stringify({stage:window.__KAIROS__.state.stage,`
            + `picks:[].map.call(document.querySelectorAll('[data-act="pick"]'),function(n){return n.getAttribute('data-id')})})` })).result.value;
        throw new Error('找不到元素 ' + sel + '；当前 ' + snap);
      }
      if (!b.hit) throw new Error('元素被遮挡，点不到 ' + sel);

      /* b.x / b.y 是元素中心点。大卡片的正文居中偏上，
         落点压到中心再往下 15%–26% 的高度，正好是下半部留白，指针不挡字 */
      const lower = b.h > 200;
      const x = Math.round(b.x + rnd(-0.16, 0.16) * b.w);
      const y = lower
        ? Math.round(b.y + b.h * rnd(0.15, 0.26))
        : Math.round(b.y + rnd(-0.14, 0.14) * b.h);

      await glideTo(x, y, opt.pause);

      await mouse('mousePressed', x, y, { buttons: 1 });
      await send('Runtime.evaluate', { expression: 'window.__CURSOR__ && window.__CURSOR__.down()' });
      await sleep(Math.round(rnd(80, 110)));
      await mouse('mouseReleased', x, y, { buttons: 0 });
      await send('Runtime.evaluate', { expression: 'window.__CURSOR__ && (window.__CURSOR__.up(),window.__CURSOR__.ping())' });
      await sleep(opt.after === undefined ? Math.round(rnd(340, 420)) : opt.after);
    }

    /* 滚轮滚动（真实 wheel 事件） */
    async function wheel(dy, pause){
      await mouse('mouseWheel', Math.round(VW * 0.5), Math.round(VH * 0.55), { deltaX: 0, deltaY: dy, button: 'none' });
      await sleep(pause === undefined ? 260 : pause);
    }

    await send('Runtime.evaluate', { expression: CURSOR_JS });
    await send('Runtime.evaluate', { expression: SIM_JS });
    await sleep(200);

    if (mode === 'probe'){
      for (const s of [1, 2, 3, 4, 5]){
        const r = await send('Runtime.evaluate', { expression:
          `(async()=>{var sleep=ms=>new Promise(r=>setTimeout(r,ms));
            try{window.__KAIROS__.closeGuide()}catch(e){}
            window.__SIM__.arm(${s});window.__KAIROS__.start();
            await sleep(320);
            var g=0;
            while(g++<300){
              var n=window.__SIM__.next();
              if(n.done) break;
              if(n.error) return {ok:false,why:n.error};
              if(n.sel){
                var e=document.querySelector(n.sel);
                if(!e) return {ok:false,why:'缺 '+n.sel+' @'+n.tag};
                e.click(); await sleep(n.tag==='过渡'?420:230);
              } else await sleep(420);
            }
            return window.__SIM__.result();
          })()`,
          awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) console.log('seed ' + s + ' 异常:', (r.exceptionDetails.exception||{}).description || r.exceptionDetails.text);
        const v = r.result.value || {};
        console.log(`seed ${s}: ${v.ok ? v.code + ' ' + v.name + '  ' + (v.top5 || []).join(',') : '失败 ' + (v.why || '')}`);
      }
    } else {
      /* ---------- 正式录制 ---------- */
      const dry = (mode === 'clickdry');   /* 只走点击流程，不录屏，用于排查 */
      /* 首页：先关掉引导（真实点击「跳过」） */
      const hasGuide = (await send('Runtime.evaluate', {
        expression: `!!document.querySelector('[data-spot="skip"]')`, returnByValue: true })).result.value;
      if (hasGuide){
        await sleep(1200);
        await clickSel('[data-spot="skip"]');
        await sleep(400);
      }

      /* 摆好初始光标位置（右下角外），避免第一帧突然冒出来 */
      await cursorTo(VW - 120, VH - 90);
      await mouse('mouseMoved', VW - 120, VH - 90, { button: 'none' });
      await sleep(700);

      const frames = [];
      if (!dry){
        on(m => {
          if (m.method === 'Page.screencastFrame'){
            frames.push({ data: m.params.data, ts: m.params.metadata.timestamp });
            ws.send(JSON.stringify({ id: 900000 + frames.length, method: 'Page.screencastFrameAck',
              params: { sessionId: m.params.sessionId } }));
          }
        });
        await send('Page.startScreencast', {
          format: 'jpeg', quality: 80,
          maxWidth: VW * DSF, maxHeight: VH * DSF, everyNthFrame: 1
        });
      }
      await sleep(dry ? 300 : 2400);            /* 首页停留 */

      /* 锁定随机种子 → 点开始 */
      await send('Runtime.evaluate', { expression: `window.__SIM__.arm(${seed})` });
      await clickSel('[data-act="start"]');
      await sleep(600);
      const dbg = (await send('Runtime.evaluate', { returnByValue: true,
        expression: `JSON.stringify({stage:window.__KAIROS__.state.stage,`
          + `cards:document.querySelectorAll('[data-act="pick"]').length,`
          + `guide:!!document.getElementById('spot'),`
          + `home:!!document.querySelector('[data-act="start"]')})` })).result.value;
      console.log('点击开始后状态：', dbg);

      /* 逐步推进：每一步都由页面状态决定点哪里，再真实点下去 */
      let step = 0;
      const trail = [];
      for (;;){
        const n = (await send('Runtime.evaluate', {
          expression: 'window.__SIM__.next()', returnByValue: true })).result.value;
        if (!n) throw new Error('next() 返回空');
        if (n.error) throw new Error(n.error);
        if (n.done) break;
        if (n.sel){
          try{
            await clickSel(n.sel, { after: n.tag === '过渡' ? 300 : undefined });
          }catch(err){
            console.log('  ⚠', err.message);
            await sleep(400);
            continue;   /* 状态可能刚变化，重取下一步 */
          }
          step++;
          trail.push(n.tag + '@' + n.sel.replace(/.*data-act="([^"]+)".*/, '$1'));
          if (dry) console.log('  ·', step, n.tag);
          if (step % 20 === 0) console.log('  已点击', step, '次');
        } else {
          await sleep(500);
        }
        if (step > 80){
          console.log('最近 12 步：', trail.slice(-12).join(' → '));
          throw new Error('步数异常，疑似死循环');
        }
      }

      const info = (await send('Runtime.evaluate', {
        expression: 'window.__SIM__.result()', returnByValue: true })).result.value;
      console.log('结果：', JSON.stringify(info, null, 1));
      await sleep(1400);

      if (dry){ ws.close(); console.log('dry 流程结束，未录屏'); return; }

      /* 结果页：用真实滚轮往下看。
         指针停在右侧留白，不要压在正文和雷达图上。 */
      const wx = Math.round(VW * 0.9), wy = Math.round(VH * 0.5);
      await cursorTo(wx, wy);
      await mouse('mouseMoved', wx, wy, { button: 'none' });
      await sleep(320);
      for (let i = 0; i < 14; i++){
        await wheel(300, 720);
        const atBottom = (await send('Runtime.evaluate', { returnByValue: true,
          expression: 'Math.round(window.scrollY+window.innerHeight) >= document.documentElement.scrollHeight-6' })).result.value;
        if (atBottom) break;
      }
      await sleep(1200);
      await cursorTo(VW - 150, VH - 110);       /* 收尾把指针挪开，露出结尾文案 */
      await mouse('mouseMoved', VW - 150, VH - 110, { button: 'none' });
      await sleep(3000);

      await send('Page.stopScreencast');
      await sleep(320);

      /* ---------- 出片 ---------- */
      const dir = path.join(ROOT, 'video_frames_pc');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      fs.readdirSync(dir).forEach(f => { try{ fs.unlinkSync(path.join(dir, f)); }catch(e){} });

      const list = [];
      for (let i = 0; i < frames.length; i++){
        const p = path.join(dir, 'f' + String(i).padStart(5, '0') + '.jpg');
        fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'));
        const next = frames[i + 1];
        const dur = next ? Math.max(1 / 60, next.ts - frames[i].ts) : 0.7;
        list.push(`file '${p.replace(/\\/g, '/')}'\nduration ${dur.toFixed(4)}`);
      }
      list.push(`file '${path.join(dir, 'f' + String(frames.length - 1).padStart(5, '0') + '.jpg').replace(/\\/g, '/')}'`);
      fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'), 'utf8');

      const secs = frames.length ? frames[frames.length - 1].ts - frames[0].ts : 0;
      console.log(`帧数 ${frames.length}，时长约 ${secs.toFixed(1)} 秒`);
      fs.writeFileSync(path.join(dir, 'meta.json'),
        JSON.stringify({ frames: frames.length, seconds: secs, info, vw: VW, vh: VH, dsf: DSF }, null, 1));
    }

    ws.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
  } finally {
    cp.kill();
  }
})().catch(e => { console.error('失败：', e.message); process.exit(1); });
