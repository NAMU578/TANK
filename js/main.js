// main.js — 진입점: UI 연결 + 게임/네트워크 초기화
import { initGame, startMatch, resetToMenu, hooks, NET, game } from './game.js';
import { hostGame, joinGame, cleanup, copyCode } from './net.js';

const $ = id => document.getElementById(id);
const screens = { menu:$('menu'), mode:$('modeScreen'), host:$('hostScreen'), join:$('joinScreen') };
let selectedMode = 'versus', selectedMap = 'bunker';

function show(name){ Object.values(screens).forEach(s=>s.classList.add('hidden')); if(screens[name])screens[name].classList.remove('hidden'); }
function hideAll(){ Object.values(screens).forEach(s=>s.classList.add('hidden')); }

// ===== 훅 연결 =====
hooks.onBanner = (text, color, dur)=>{
  const b=$('banner'), m=$('bannerMsg');
  m.textContent=text; m.style.color=color||'#fff'; b.style.display='flex';
  if(window.__bannerT)clearTimeout(window.__bannerT);
  if(dur)window.__bannerT=setTimeout(()=>{ b.style.display='none'; }, dur);
};
hooks.setNames = (me, foe)=>{ $('meName').textContent=me; $('foeName').textContent=foe; };
hooks.onModeEnd = ()=>{ cleanup(); resetToMenu(); show('menu'); };
hooks.onHud = (s)=>{
  $('meHp').style.width=Math.max(0,s.meHp)+'%';
  if(s.mode==='versus'){
    $('versusHud').style.display='flex';
    $('coopHud').style.display='none';
    $('foeHp').style.width=Math.max(0,s.foeHp)+'%';
    $('scoreText').textContent=s.scoreMe+' : '+s.scoreFoe;
    $('roundText').textContent='라운드 '+s.round;
  } else {
    $('versusHud').style.display='none';
    $('coopHud').style.display='block';
    $('waveText').textContent='웨이브 '+s.wave;
    $('coopScoreText').textContent=s.coopScore+'점';
    $('coopLivesText').textContent='❤ '.repeat(Math.max(0,s.coopLives));
    if($('foeBox')) $('foeBox').style.display = NET.connected ? 'block':'none';
    if(NET.connected) $('foeHp').style.width=Math.max(0,s.foeHp)+'%';
  }
  // 재장전 게이지
  const r=$('reloadBar'); r.style.width=(s.reloadRatio*100)+'%';
  r.style.background = s.reloadRatio>=1 ? '#74f0a7' : (s.rapid>0?'#ffd166':'#ffb84d');
  // 부스트 연료
  $('boostBar').style.width=s.boostFuel+'%';
  // 버프 표시
  let buffs='';
  if(s.shield>0)buffs+='🛡️ ';
  if(s.rapid>0)buffs+='⚡ ';
  $('buffs').textContent=buffs;
};

// ===== 메뉴 이벤트 =====
$('playBtn').addEventListener('click', ()=>{ show('mode'); });
$('quickJoinConnectBtn').addEventListener('click', ()=>{
  joinGame($('quickJoinCode').value, (text,cls)=>setStatus('quickJoinStatus', text, cls));
});
$('quickJoinCode').addEventListener('keydown', e=>{ if(e.key==='Enter')$('quickJoinConnectBtn').click(); });
$('soloBtn').addEventListener('click', ()=>{
  NET.solo=true; NET.connected=false; NET.isHost=true;
  game.myId='p1'; game.foeId='p2';
  hooks.setNames('나','AI 봇');
  hideAll(); startMatch('versus', selectedMap);
});

// 모드 선택 화면
document.querySelectorAll('[data-mode]').forEach(el=>{
  el.addEventListener('click', ()=>{
    selectedMode = el.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(e=>e.classList.remove('sel'));
    el.classList.add('sel');
    $('mapSection').style.display='block';
  });
});
document.querySelectorAll('[data-map]').forEach(el=>{
  el.addEventListener('click', ()=>{
    selectedMap = el.dataset.map;
    document.querySelectorAll('[data-map]').forEach(e=>e.classList.remove('sel'));
    el.classList.add('sel');
    $('flowSection').style.display='block';
  });
});
$('goHost').addEventListener('click', ()=>{ startHosting(); });
$('modeBack').addEventListener('click', ()=>show('menu'));

function startHosting(){
  show('host');
  hostGame(selectedMode, selectedMap,
    code=>{ $('roomCode').textContent=code; },
    (text,cls)=>setStatus('hostStatus', text, cls));
}

// 참가 화면
$('connectBtn').addEventListener('click', ()=>{
  joinGame($('codeInput').value, (text,cls)=>setStatus('joinStatus', text, cls));
});
$('codeInput').addEventListener('keydown', e=>{ if(e.key==='Enter')$('connectBtn').click(); });
$('hostBack').addEventListener('click', ()=>{ cleanup(); show('mode'); });
$('joinBack').addEventListener('click', ()=>{ cleanup(); show('mode'); });

$('roomCode').addEventListener('click', ()=>{
  const c=$('roomCode').textContent;
  if(c && c!=='····') copyCode(c).then(()=>{ $('copyHint').textContent='복사됨! 친구에게 붙여넣기 하세요.'; }).catch(()=>{});
});

function setStatus(id, text, cls){
  const el=$(id);
  el.className='status '+(cls==='err'?'err':cls==='ok'?'ok':'');
  el.innerHTML=(cls==='wait'?'<span class="spinner"></span>':'')+text;
}

// ===== 시작 =====
window.addEventListener('load', ()=>{
  initGame($('game'));
  show('menu');
});
