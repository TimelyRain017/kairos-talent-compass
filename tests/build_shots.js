/* 生成 4 张状态截图页，供 chrome --headless --screenshot 使用 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, '才干罗盘_MVP2.html'), 'utf8');

const seed2 = `
  var A = k.ARCHETYPES, D = k.DOMAINS;
  function mk(top5){
    k.state.order = top5;
    var sc = k.computeScores();
    var arch = k.judgeArchetype(top5);
    var low = 'S';
    ['S','E','R','I'].forEach(function(x){ if (sc.dom[x] < sc.dom[low]) low = x; });
    var desc = k.DESC[arch.code + '_main'] || k.DESC[arch.main];
    var drain = k.TALENTS.filter(function(t){ return t.d === low; })
      .sort(function(a,b){ return sc.item[a.id] - sc.item[b.id]; }).slice(0,3)
      .map(function(t){
        var d = k.DRAIN[t.id] || {scene:'',action:'规避',actionText:''};
        return {name:t.name, scene:d.scene, action:d.action, actionText:d.actionText};
      });
    return {top5:top5.slice(), item:sc.item, dom:sc.dom, arch:arch, lowest:low,
      desc:desc, advice:k.ADVICE[low].slice(0,3), drain:drain};
  }
  var ids = k.TALENTS.map(function(t){ return t.id; });
  k.records.length = 0;
  k.records.push({ts: Date.now() - 3600e3*20, result: mk([ids[0],ids[6],ids[13],ids[21],ids[29]])});
  k.records.push({ts: Date.now() - 3600e3*3,  result: mk([ids[3],ids[9],ids[17],ids[25],ids[31]])});
`;

const cases = {
  shot_home: `
    k.render();
  `,
  shot_home_rec: seed2 + `
    k.render();
  `,
  shot_mine: seed2 + `
    k.state.stage = 'mine';
    k.render();
  `,
  shot_mine_empty: `
    k.records.length = 0;
    k.state.stage = 'mine';
    k.render();
  `,
  shot_mine_off: seed2 + `
    k.pref.remember = false;
    k.records.length = 0;
    k.state.stage = 'mine';
    k.render();
  `,
  shot_duel: `
    k.start();
    k.resolvePair('a'); k.resolvePair('b'); k.resolvePair('a'); k.resolvePair('b');
    k.resolvePair('a'); k.resolvePair('a'); k.resolvePair('b'); k.resolvePair('a');
  `,
  shot_rescue: `
    k.start();
    var g = 0;
    while (g++ < 60){
      var s = k.state;
      if (s.stage === 'duel') k.resolvePair('a');
      else if (s.stage === 'roundEnd') k.gotoRescue();
      else break;
    }
    k.gotoRescue();
  `,
  shot_guide1: `
    k.openGuide(true);
  `,
  shot_guide2: `
    k.openGuide(true);
    setTimeout(function(){ k.spot.i = 1; k.paintSpot(); }, 260);
  `,
  shot_guide3: `
    k.openGuide(true);
    setTimeout(function(){ k.spot.i = 2; k.paintSpot(); }, 260);
  `,
  shot_result: seed2 + `
    k.state.result = k.records[1].result;
    k.state.stage = 'result';
    k.state.fromMine = true;
    k.render(); window.scrollTo(0,0);
  `
};

Object.keys(cases).forEach(function(name){
  const inject = `
<script>
(function(){
  var k = window.__KAIROS__;
  try { ${cases[name]} }
  catch(e){ document.title = 'ERR:' + e.message; }
})();
<\/script>
`;
  const out = src.replace('</body>', inject + '</body>');
  fs.writeFileSync(path.join(__dirname, name + '.html'), out);
  console.log('built', name);
});
