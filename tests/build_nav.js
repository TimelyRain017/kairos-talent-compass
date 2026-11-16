/* 生成注入式端到端测试页：把主文件复制一份，尾部追加测试脚本，
   结果写到 document.title，供 chrome --headless --dump-dom 抓取。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, '才干罗盘_MVP2.html'), 'utf8');

const inject = `
<script>
(function(){
  var log = [];
  function L(k, v){ log.push(k + '=' + v); }
  function K(){ return window.__KAIROS__; }
  function q(s){ return document.querySelector(s); }
  function qa(s){ return document.querySelectorAll(s); }
  function stage(){ return K().state.stage; }

  function run(){
    var k = K();

    /* 1 首页 */
    L('1.stage', stage());
    L('1.tabbar', qa('.tabbar button').length);
    L('1.tabHome', q('.tabbar button[data-act=goHome]').className);

    /* 2 开始 → 连选三对 */
    k.start();
    L('2.start', stage());
    k.resolvePair('a'); k.resolvePair('b'); k.resolvePair('a');
    L('2.pairIndex', k.state.pairIndex);
    L('2.undo', k.state.undoStack.length);
    L('2.winners', k.state.winners.length);

    /* 3 返回撤销一对 */
    k.goBack();
    L('3.stage', stage());
    L('3.pairIndex', k.state.pairIndex);
    L('3.undo', k.state.undoStack.length);
    L('3.winners', k.state.winners.length);

    /* 4 再撤两对 → 到底 */
    k.goBack(); k.goBack();
    L('4.pairIndex', k.state.pairIndex);
    L('4.undo', k.state.undoStack.length);

    /* 5 撤不动了 → 回主页，保留继续入口 */
    k.goBack();
    L('5.stage', stage());
    L('5.resume', k.state.resume);
    L('5.label', k.state.resumeLabel);
    L('5.resumeBox', !!q('.resume-box'));
    L('5.tabbar', qa('.tabbar button').length);

    /* 6 主页回写盘时必须是真实阶段 */
    var raw = localStorage.getItem('kairos_v1');
    L('6.diskStage', raw ? JSON.parse(raw).stage : 'null');

    /* 7 继续 → 回到对决 */
    q('.resume-box [data-act=resume]').click();
    L('7.stage', stage());
    L('7.pairIndex', k.state.pairIndex);

    /* 8 我的 */
    k.goMine();
    L('8.stage', stage());
    L('8.tabMine', q('.tabbar button[data-act=goMine]').className);
    L('8.switch', !!q('.switch'));
    L('8.switchOn', q('.switch').className);
    L('8.empty', !!q('.mine-empty'));
    L('8.dangerBtn', !!q('.danger'));

    /* 9 关记忆 → 弹窗 → 取消 */
    k.toggleMem();
    L('9.mask', !!q('.mask'));
    q('.mask [data-modal=cancel]').click();
    L('9.afterCancel.remember', k.pref.remember);
    L('9.afterCancel.mask', !!q('.mask'));

    /* 10 完整跑一局到结果 */
    k.goHome();
    k.start();
    var guard = 0;
    while (guard++ < 300){
      var st = k.state;
      if (st.stage === 'duel') k.resolvePair(Math.random() < 0.5 ? 'a' : 'b');
      else if (st.stage === 'roundEnd') k.gotoRescue();
      else if (st.stage === 'rescue') k.doRescue(null);
      else if (st.stage === 'order') k.pickFirst(st.orderPool[0]);
      else break;
    }
    L('10.stage', k.state.stage);
    L('10.loops', guard);
    L('10.records', k.records.length);
    L('10.recDisk', (localStorage.getItem('kairos_rec_v1') || '').length > 100);
    L('10.resultTop5', k.state.result ? k.state.result.top5.length : -1);
    L('10.resNav', !!q('.res-nav .nav-back'));

    /* 11 主页出现「上次」 */
    k.goHome();
    L('11.stage', stage());
    L('11.lastRec', !!q('.last-rec'));
    L('11.lastName', q('.last-rec') ? q('.last-rec .lr-n').textContent : '');

    /* 12 我的里能看见记录并打开 */
    k.goMine();
    L('12.recCards', qa('.rec').length);
    k.openRec(0);
    L('12.openStage', stage());
    L('12.fromMine', k.state.fromMine);
    L('12.archName', q('.arch') ? q('.arch').textContent : '');
    L('12.shareBanner', !!q('.share-banner'));

    /* 13 从结果返回 → 我的 */
    k.goBack();
    L('13.stage', stage());

    /* 14 清除本机记忆 → 确认 */
    q('.danger').click();
    L('14.mask', !!q('.mask'));
    q('.mask [data-modal=ok]').click();
    L('14.records', k.records.length);
    L('14.recDisk', localStorage.getItem('kairos_rec_v1'));
    L('14.empty', !!q('.mine-empty'));

    /* 15 关掉记忆后不再落盘 */
    k.toggleMem();
    k.toggleMem();  /* 打开 */
    L('15.on.remember', k.pref.remember);
    k.forgetAll();
    L('15.off.remember', k.pref.remember);
    k.start(); k.resolvePair('a');
    L('15.diskAfterOff', localStorage.getItem('kairos_v1'));

    /* 16 重新开启记忆后恢复正常 */
    k.toggleMem();
    L('16.remember', k.pref.remember);
    k.resolvePair('b');
    var raw2 = localStorage.getItem('kairos_v1');
    L('16.diskStage', raw2 ? JSON.parse(raw2).stage : 'null');

    /* 清掉前面残留的确认弹窗 */
    Array.prototype.slice.call(qa('.mask')).forEach(function(m){
      if (m.parentNode) m.parentNode.removeChild(m);
    });

    /* 17 聚光灯引导 */
    k.goHome();
    k.state.resume = false;
    k.render();
    k.openGuide(true);
    k.paintSpot();
    L('17.on', k.spot.on);
    L('17.hole', !!q('#spotHole'));
    L('17.holeW', Math.round(parseFloat(q('#spotHole').style.width)));
    L('17.sno', q('.sno') ? q('.sno').textContent : '');
    L('17.title', q('.spot-tip h3') ? q('.spot-tip h3').textContent : '');
    L('17.tipTop', Math.round(parseFloat(q('#spotTip').style.top)));
    L('17.dots', qa('.spot-dots i').length);
    L('17.dotOn', qa('.spot-dots i.on').length);
    L('17.bodyLock', document.body.classList.contains('spot-open'));

    /* 18 逐步前进 */
    q('[data-spot=next]').click();
    L('18.i', k.spot.i);
    L('18.sno', q('.sno').textContent);
    L('18.holeMoved', Math.round(parseFloat(q('#spotHole').style.top)));
    q('[data-spot=next]').click();
    L('18.i2', k.spot.i);
    L('18.btnText', q('[data-spot=next]').textContent);

    /* 19 最后一步收尾 */
    q('[data-spot=next]').click();
    L('19.on', k.spot.on);
    L('19.dom', !!q('#spot'));
    L('19.seen', k.pref.seenGuide);
    L('19.bodyLock', document.body.classList.contains('spot-open'));
    L('19.prefDisk', JSON.parse(localStorage.getItem('kairos_pref_v1') || '{}').seenGuide);

    /* 20 已看过就不再自动播 */
    L('20.autoSkipped', (function(){ k.openGuide(false); return k.spot.on; })());

    /* 21 我的页重看入口 */
    k.goMine();
    L('21.replayBtn', !!q('[data-act=replayGuide]'));
    q('[data-act=replayGuide]').click();
    k.paintSpot();
    L('21.stage', stage());
    L('21.on', k.spot.on);
    L('21.sno', q('.sno') ? q('.sno').textContent : '');
    k.closeGuide();
    L('21.closed', !!q('#spot'));

    /* 22 跳过按钮 */
    k.goHome();
    k.openGuide(true);
    k.paintSpot();
    q('[data-spot=skip]').click();
    L('22.on', k.spot.on);
    L('22.dom', !!q('#spot'));
  }

  try { run(); }
  catch (e){ log.push('ERROR=' + (e && e.message) + ' @ ' + (e && e.stack || '').split('\\n')[1]); }

  document.title = 'RESULT|' + JSON.stringify(log);
})();
<\/script>
`;

const out = src.replace('</body>', inject + '</body>');
fs.writeFileSync(path.join(__dirname, '_nav.html'), out);
console.log('built tests/_nav.html', out.length);
