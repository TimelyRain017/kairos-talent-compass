/* 验证首次访问是否自动播放引导 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const src = fs.readFileSync(path.join(ROOT, '才干罗盘_MVP2.html'), 'utf8');

const probe = `<script>
setTimeout(function(){
  var s = document.getElementById('spot');
  var tip = document.querySelector('.spot-tip');
  var hole = document.getElementById('spotHole');
  var out = [
    'spot=' + !!s,
    'sno=' + (s ? s.querySelector('.sno').textContent : '-'),
    'nextBtn=' + !!document.querySelector('[data-spot=next]'),
    'skipBtn=' + !!document.querySelector('[data-spot=skip]'),
    'holeTop=' + (hole ? hole.style.top : '-'),
    'holeW=' + (hole ? hole.style.width : '-'),
    'lock=' + document.body.classList.contains('spot-open')
  ].join(' | ');
  document.title = 'AUTO|' + out;
}, 1500);
</script>`;

fs.writeFileSync(path.join(__dirname, '_auto.html'), src.replace('</body>', probe + '</body>'));

const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--user-data-dir=C:/tmp/chr_auto_' + Date.now(),
  '--virtual-time-budget=5000',
  '--dump-dom', 'file:///' + path.join(__dirname, '_auto.html').replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const m = dom.match(/<title>([^<]*)<\/title>/);
console.log(m ? m[1] : 'NO TITLE');
