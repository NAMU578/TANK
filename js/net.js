// net.js — PeerJS P2P 연결 (방 코드 기반)
import { NET, game, hooks, startMatch, applyStateSnapshot, handleRoundEvent,
         handleWaveEvent, shootFromNet, resetToMenu } from './game.js';

const ROOM_PREFIX = 'tankclash3d-';
let peer = null, conn = null;
let pendingMode = 'versus', pendingMap = 'bunker';
let sessionStarted = false;

function hideScreens() {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
}


function code4(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s='';
  for(let i=0;i<4;i++)s+=c[Math.floor(Math.random()*c.length)];
  return s;
}

function send(obj){ if(conn && conn.open){ try{conn.send(obj);}catch(e){} } }
NET.sendFn = send;

export function hostGame(mode, mapKey, onCode, onStatus){
  NET.isHost=true; NET.solo=false; NET.connected=false;
  pendingMode=mode; pendingMap=mapKey;
  const code=code4();
  onCode(code);
  onStatus('연결 준비 중...', 'wait');

  peer = new Peer(ROOM_PREFIX+code, { debug:1 });
  peer.on('open', ()=> onStatus('친구가 코드를 입력하면 자동 시작됩니다.', 'wait'));
  peer.on('error', err=>{
    if(err.type==='unavailable-id'){ peer.destroy(); hostGame(mode,mapKey,onCode,onStatus); }
    else onStatus('연결 오류: '+err.type, 'err');
  });
  peer.on('connection', c=>{
    conn=c;
    c.on('open', ()=>{
         NET.connected = true;
         sessionStarted = false;
         onStatus('상대 연결됨. 참가자 준비 대기 중...', 'wait');
         game.myId = 'p1';
         game.foeId = 'p2';
         hooks.setNames && hooks.setNames(
         mode === 'coop' ? '플레이어 1' : '나 (호스트)',
         mode === 'coop' ? '플레이어 2' : '상대'
         );
         c.on('data', hostOnData);
         });

    c.on('close', onDisconnect);
  });
}

function hostOnData(msg){
  if (!msg || typeof msg !== 'object') return;

  if (msg.t === 'ready') {
    if (sessionStarted) return;
    sessionStarted = true;
    hideScreens();
    send({ t:'start', mode:pendingMode, map:pendingMap });
    startMatch(pendingMode, pendingMap);
    return;
  }

  if (msg.t === 'input') NET.guestInput = msg;
  else if (msg.t === 'shoot') shootFromNet(msg);
}


export function joinGame(code, onStatus){
  code=(code||'').trim().toUpperCase();
  if(code.length!==4){ onStatus('4자리 코드를 입력하세요.', 'err'); return; }
  onStatus('연결 중...', 'wait');
  NET.isHost=false; NET.solo=false;
  peer=new Peer(null,{debug:1});
  peer.on('open', ()=>{
    conn=peer.connect(ROOM_PREFIX+code,{reliable:true});
    let opened=false;
    const to=setTimeout(()=>{ if(!opened)onStatus('연결 실패: 코드를 확인하세요.','err'); },8000);
    conn.on('open', ()=>{
  opened = true;
  clearTimeout(to);
  NET.connected = true;
  onStatus('연결됨! 시작합니다.', 'ok');
  game.myId = 'p2';
  game.foeId = 'p1';
  conn.on('data', guestOnData);
  send({ t:'ready' });
});

    conn.on('close', onDisconnect);
  });
  peer.on('error', err=> onStatus('연결 오류: '+err.type,'err'));
}

function guestOnData(msg){
  if(!msg||typeof msg!=='object')return;
  if (msg.t === 'start') {
  hideScreens();
  hooks.setNames && hooks.setNames(
    msg.mode === 'coop' ? '플레이어 2' : '나 (게스트)',
    msg.mode === 'coop' ? '플레이어 1' : '상대'
  );
  startMatch(msg.mode, msg.map);
}

  else if(msg.t==='state') applyStateSnapshot(msg);
  else if(msg.t==='round') handleRoundEvent(msg);
  else if(msg.t==='wave') handleWaveEvent(msg);
}

function onDisconnect(){
  if(game.phase==='menu')return;
  NET.connected=false;
  hooks.onBanner && hooks.onBanner('상대와 연결이 끊겼습니다','#ff6b8f',2500);
  setTimeout(()=>{ cleanup(); hooks.onModeEnd && hooks.onModeEnd(); },2600);
}

export function cleanup(){
  try{ if(conn)conn.close(); }catch(e){}
  try{ if(peer)peer.destroy(); }catch(e){}
  peer=null; conn=null;
  NET.connected=false; NET.isHost=false; NET.solo=false;
  sessionStarted = false;

}

export function copyCode(code){
  if(navigator.clipboard) return navigator.clipboard.writeText(code);
  return Promise.reject();
}
