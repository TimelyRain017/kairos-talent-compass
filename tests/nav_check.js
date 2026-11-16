/* 校验：返回=回首页；导航在PC顶部、手机底部 */
const { spawn } = require('child_process');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cdp(ws){
  let id = 0;
  const waits = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)){ waits.get(m.id)(m); waits.delete(m.id); }
  });
  return (method, params) => new Promise((res, rej) => {
    const i = ++id;
    waits.set(i, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
}

async function waitPort(){
  for (let i = 0; i < 60; i++){
    try{ const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; }catch(e){}
    await sleep(200);
  }
  throw new Error('CDP 端口没起来');
}

(async () => {
  const cp = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--allow-file-access-from-files', '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/tmp/chr_nav_' + Date.now()], { stdio: 'ignore' });

  try{
    await waitPort();
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const send = cdp(ws);
    await send('Page.enable');

    const url = 'file:///' + path.join(ROOT, '才干罗盘_MVP2.html').replace(/\\/g, '/');

    async function setViewport(w, h){
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 769 });
      await sleep(250);
    }
    async function ev(expr){
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result && r.result.value;
    }

    await setViewport(1200, 820);
    await send('Page.navigate', { url });
    await sleep(900);

    const pc = await ev(`(function(){
      var t=document.querySelector('.tabbar');
      if(!t) return {err:'no tabbar'};
      var cs=getComputedStyle(t);
      return {pos:cs.position, top:cs.top, bottom:cs.bottom, brand:!!document.querySelector('.tabbar .tb-brand:not([style*="display: none"])'),
              brandVisible:getComputedStyle(document.querySelector('.tabbar .tb-brand')).display,
              h1:document.querySelector('.intro h1')?document.querySelector('.intro h1').textContent.trim():'',
              chips:[].slice.call(document.querySelectorAll('.nb-chip .lb')).map(function(e){return e.textContent;})};
    })()`);
    console.log('PC   :', JSON.stringify(pc));

    await setViewport(390, 844);
    await sleep(300);
    const m = await ev(`(function(){
      var t=document.querySelector('.tabbar'); var cs=getComputedStyle(t);
      return {pos:cs.position, top:cs.top, bottom:cs.bottom,
              brandVisible:getComputedStyle(document.querySelector('.tabbar .tb-brand')).display};
    })()`);
    console.log('手机 :', JSON.stringify(m));

    const back = await ev(`(function(){
      var K=window.__KAIROS__;
      try{K.closeGuide()}catch(e){}
      K.start();
      var s1=K.state.stage, r1=K.state.round, p1=K.state.pairIndex;
      K.resolvePair('a'); K.resolvePair('a');
      var p2=K.state.pairIndex;
      K.goBack();
      return {afterStart:s1, progressBefore:p2, stageAfterBack:K.state.stage,
              resume:K.state.resume, label:K.state.resumeLabel||'', round:K.state.round};
    })()`);
    console.log('返回 :', JSON.stringify(back));

    const bar = await ev(`(function(){
      var b=document.querySelector('.progbar');
      return b? {h:getComputedStyle(b).height, r:getComputedStyle(b).borderRadius} : {err:'none'};
    })()`);
    console.log('进度 :', JSON.stringify(bar));

    ws.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
  } finally { cp.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
