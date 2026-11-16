/* 用 CDP 精确模拟移动端视口截图（Chrome headless 的 --window-size 有最小限制） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const ROOT = path.resolve(__dirname, '..');
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
    try{
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    }catch(e){}
    await sleep(200);
  }
  throw new Error('CDP 端口没起来');
}

async function shoot(file, out, opts){
  opts = opts || {};
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const send = cdp(ws);

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: opts.width || 390, height: opts.height || 844,
    deviceScaleFactor: 1, mobile: opts.mobile !== false
  });
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });

  for (let i = 0; i < 40; i++){
    await sleep(150);
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (r.result && r.result.value === 'complete') break;
  }
  await sleep(opts.wait || 700);

  if (opts.eval){
    await send('Runtime.evaluate', { expression: opts.eval, awaitPromise: true });
    await sleep(opts.evalWait || 500);
  }

  if (opts.scrollY){
    await send('Runtime.evaluate', { expression: 'window.scrollTo(0,' + opts.scrollY + ')' });
    await sleep(300);
  }

  const cap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(cap.data, 'base64'));

  const err = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  if (err.result && /^ERR:/.test(err.result.value || '')) console.log('  ⚠ ' + err.result.value);

  ws.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
  return out;
}

(async () => {
  const cp = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/tmp/chr_cdp_' + Date.now()], { stdio: 'ignore' });

  try{
    await waitPort();
    const outDir = path.join(ROOT, 'shots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    const cases = JSON.parse(process.argv[2] || '[]');
    for (const c of cases){
      const file = path.join(ROOT, c.file || ('tests/' + c.name + '.html'));
      const out = path.join(outDir, c.out || (c.name + '.png'));
      await shoot(file, out, c);
      console.log('shot →', path.basename(out));
    }
  } finally {
    cp.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
