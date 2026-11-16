/* 单独调试：只跑流程 + 导出 canvas 分享图 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, '才干罗盘_MVP2.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cdp(ws){
  let id = 0;
  const waits = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Inspector.targetCrashed') console.log('!! targetCrashed');
    if (m.method === 'Runtime.consoleAPICalled'){
      const a = (m.params.args || []).map(x => x.value).join(' ');
      if (a) console.log('  [page]', a);
    }
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

(async () => {
  const cp = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/tmp/chr_card_' + Date.now()], { stdio:'ignore' });
  cp.on('exit', c => console.log('chrome exit', c));

  try{
    for (let i = 0; i < 60; i++){
      try{ const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; }catch(e){}
      await sleep(200);
    }
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method:'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const send = cdp(ws);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Inspector.enable');
    await send('Emulation.setDeviceMetricsOverride', { width:1440, height:1080, deviceScaleFactor:1, mobile:false });
    await send('Page.navigate', { url: PAGE });
    for (let i = 0; i < 40; i++){
      await sleep(150);
      const r = await send('Runtime.evaluate', { expression:'document.readyState', returnByValue:true });
      if (r.result && r.result.value === 'complete') break;
    }
    await sleep(600);

    /* 用分享码直接还原结果，省掉跑流程 */
    const code = fs.readFileSync(path.join(ROOT, 'shots', 'share_url.txt'), 'utf8').split('#r=')[1].trim();
    console.log('share code', code);
    const dec = await send('Runtime.evaluate', { expression:
      `(function(){var K=window.__KAIROS__;var r=K.decodeResult('${code}');
        if(!r) return 'decode fail';
        K.state.shareView=true;K.state.stage='result';K.state.result=r;K.render();
        return r.arch.code+' '+(K.ARCHETYPES[r.arch.code]||{}).name;})()`, returnByValue:true });
    console.log('还原:', dec.result.value);
    await sleep(400);

    console.log('开始生成卡片…');
    const card = await send('Runtime.evaluate', { expression: `(function(){
      return new Promise(function(resolve){
        var t = setTimeout(function(){ resolve({ ok:false, why:'timeout' }); }, 10000);
        try{
          window.__KAIROS__.renderCard(function(cv){
            clearTimeout(t);
            if (!cv){ resolve({ ok:false, why:'null cv' }); return; }
            var u;
            try { u = cv.toDataURL('image/png'); } catch(e){ resolve({ ok:false, why:'dataURL '+e }); return; }
            resolve({ ok:true, w:cv.width, h:cv.height, len:u.length, url:u });
          });
        }catch(e){ clearTimeout(t); resolve({ ok:false, why:String(e) }); }
      });
    })()`, awaitPromise:true, returnByValue:true });
    if (card.exceptionDetails) console.log('异常:', JSON.stringify(card.exceptionDetails).slice(0, 500));
    const v = card.result && card.result.value;
    if (!v || !v.ok){ console.log('失败:', JSON.stringify(v)); return; }
    console.log('ok', v.w + 'x' + v.h, 'base64 len', v.len);
    fs.writeFileSync(path.join(ROOT, 'shots', '分享图_1080x1920.png'), Buffer.from(v.url.split(',')[1], 'base64'));
    console.log('saved');

    /* 顺手截「弹层预览」这张：手机上点开存图后长什么样 */
    await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
    await send('Runtime.evaluate', { expression:
      'try{window.__KAIROS__.closeGuide()}catch(e){}' });
    await send('Runtime.evaluate', { expression:
      'window.__KAIROS__.state.shareView=false; window.__KAIROS__.render(); window.scrollTo(0,0);' });
    await sleep(500);
    await send('Runtime.evaluate', { expression:
      'document.querySelector(\'[data-act="saveCard"]\').click();' });
    await sleep(2500);
    /* 遮罩原本 94% 透明，底层文字会微微透出来；截图时补满，避免脏底 */
    await send('Runtime.evaluate', { expression:
      'var m=document.querySelector(".cardmodal"); if(m) m.style.background="#101518";' });
    await sleep(300);
    const st = await send('Runtime.evaluate', { expression:
      'JSON.stringify({guide:!!document.querySelector(".guide,[data-spot]"),modal:!!document.querySelector(".cardmodal"),op:document.querySelector(".cardmodal")?getComputedStyle(document.querySelector(".cardmodal")).opacity:null})',
      returnByValue:true });
    console.log('状态:', st.result.value);
    const shot = await send('Page.captureScreenshot', { format:'png' });
    fs.writeFileSync(path.join(ROOT, 'shots', '分享图_弹层预览_手机.png'), Buffer.from(shot.data, 'base64'));
    console.log('modal shot saved');
  } finally {
    cp.kill();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
