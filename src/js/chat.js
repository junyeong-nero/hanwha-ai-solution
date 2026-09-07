/* ================= 채팅 리스트 ================= */
function updateBdg(){
  const n=Object.values(S.rooms).reduce((s,r)=>s+r.unread,0);
  $('chatbdg').style.display=n?'flex':'none';$('chatbdg').textContent=n;
}
function renderRooms(){
  const n=S.joined.length; $('roomcount').textContent=n?n+'개':'';
  if(!n){
    $('roomlist').innerHTML='<div class="empty"><i>🌘</i><b>아직 참여한 모임이 없어요</b>매칭 탭에서 마음에 드는 모임에 참가하면<br>여기서 익명으로 대화가 시작돼요.'
      +'<button class="cta sm" onclick="go(\'match\')">모임 둘러보기</button></div>';return;
  }
  $('roomlist').innerHTML=S.joined.map(id=>{
    const m=MEETINGS.find(x=>x.id===id), r=S.rooms[id];
    if(!m||!r)return '';
    const last=BACKEND?{x:r.last||'대화를 시작해 보세요',t:r.lastT||''}:r.msgs.length?r.msgs[r.msgs.length-1]:{x:r.last||'대화를 시작해 보세요',t:r.lastT||''};
    const isAi=last.f==='ai', lastTxt=isAi?'MoonLight AI가 약속을 제안했어요':(last.x||'');
    const right=r.unread?'<span class="ub">'+r.unread+'</span>':r.planned?'<span class="pl">'+ico('cal')+' 약속 확정</span>':'';
    return '<button class="room" onclick="openRoom(\''+id+'\')">'
      +'<span class="av">'+esc(m.em||'🌙')+(r.iAttended?'<span class="full">🌕</span>':'')+'</span>'
      +'<span class="bd"><span class="r1"><b>'+esc(m.name)+'<small>'+roomTotal(id)+'</small></b><time>'+(last.t||'')+'</time></span>'
      +'<span class="r2"><p'+(isAi?' class="ai"':'')+'>'+(isAi?'🌙 ':'')+esc(String(lastTxt||'').slice(0,44))+'</p>'+right+'</span></span></button>';
  }).join('');
}

/* ================= 채팅방 ================= */
let CUR=null;
const UNKNOWN={real:null,nick:'익명',co:null,av:'🌙'};
const MYID=()=>ME||'me';
function roomTotal(id){const m=MEETINGS.find(x=>x.id===id);return (m?memberTotal(m):0)+1}
/* 실명은 나와 "서로 만남 완료"로 연결된 사람만 보인다 (각자 다르게 보임) */
function label(pid,room){
  const p=PEOPLE[pid]||UNKNOWN, c=co(p.co);
  if(S.met[pid]&&p.real) return '<b style="color:var(--tx)">'+esc(p.real)+'</b><small>'+(c?c.name:'')+'</small>';
  return esc(p.nick)+'<small>익명</small>';
}
function renderMeta(id){
  const m=MEETINGS.find(x=>x.id===id), r=S.rooms[id]; if(!m||!r)return;
  $('rname').textContent=m.name;
  const anon=m.members.filter(p=>!S.met[p]).length, total=roomTotal(id);
  $('rmeta').textContent='멤버 '+total+' · 익명 '+anon+'명'+(r.attended.size?' · 만남 완료 '+r.attended.size+'/'+total:'');
  $('memCount').textContent=total;
  $('albBtn').style.visibility=r.iAttended?'visible':'hidden';
}
/* 채팅방 멤버 보기: 표시 이름 · 확정 투표 · 만남 완료 여부 */
async function openMembers(){
  const id=CUR; if(!id)return;
  if(BACKEND)await refreshMembers(id);
  const m=MEETINGS.find(x=>x.id===id), r=S.rooms[id]; if(!m||!r)return;
  const ai=[...r.msgs].reverse().find(x=>x.f==='ai'), votes=ai?(r.votes[ai.planId]||new Set()):null;
  const P=S.profile, myCo=co(P.company);
  const rows=[{id:MYID(),av:P.av,name:P.realName||P.nick,sub:(myCo?myCo.name:'')+' · 나 ('+P.nick+')',me:true,ints:[...P.interests,...P.hobbies]}]
    .concat(m.members.map(pid=>{const p=PEOPLE[pid]||UNKNOWN, c=co(p.co), known=!!(S.met[pid]&&p.real);
      return {id:pid,av:p.av,name:known?p.real:p.nick,sub:known?(c?c.name:''):'익명 · 만남 완료 후 실명이 보여요',known,ints:p.ints||[]};}));
  $('memlist').innerHTML=rows.map(x=>{
    const att=r.attended.has(x.id), voted=!!(votes&&votes.has(x.id));
    // 관심사 태그는 익명 상태에서도 보인다 — 실명·사번 없이 대화 소재만
    const tags=x.ints.length?'<span class="mtags">'+x.ints.slice(0,3).map(t=>'<i>#'+esc(t)+'</i>').join('')+'</span>':'';
    return '<div class="memrow"><div class="mav">'+esc(x.av||'🌙')+'</div><div class="nm"><b>'+esc(x.name)+(x.me?' <small style="color:var(--orange)">ME</small>':'')+'</b><small>'+esc(x.sub)+'</small>'+tags+'</div>'
      +'<div class="bd">'+(x.known?'<button class="inv" onclick="inviteNext(\''+x.id+'\')">다음 모임</button>':'')
      +(ai?'<span class="mbadge'+(voted?' on':'')+'">'+(voted?'확정 ✓':'미확정')+'</span>':'')
      +'<span class="mbadge'+(att?' full':'')+'">'+(att?'만남 완료':'만남 전')+'</span></div></div>';
  }).join('');
  const total=roomTotal(id), anon=m.members.filter(p=>!S.met[p]).length;
  $('memsum').textContent='멤버 '+total+'명 · 익명 '+anon+'명'+(ai?' · 확정 '+(votes?votes.size:0)+'/'+total:'')+' · 만남 완료 '+r.attended.size+'/'+total;
  $('memwrap').classList.add('on');
}
function hideMembers(){$('memwrap').classList.remove('on')}
/* 약속 시각이 지났는지. meetAt 이 없는 카드("평일 저녁"처럼 날짜를 짚을 수 없는 문구)는 항상 false */
function planDue(plan){ const t=plan&&!plan.collecting&&plan.meetAt?Date.parse(plan.meetAt):NaN; return Number.isFinite(t)&&t<=Date.now() }
function planDoneMsg(reason,plan){
  if(reason==='host')return '방장이 약속을 확정했어요 — '+plan.when+' · '+plan.place;
  return reason==='due'
    ? '🌕 약속 시간이 지나 자동으로 확정했어요 — '+esc(plan.when)+' · '+esc(plan.place)+' · 만나셨다면 만남 완료를 눌러 주세요'
    : '📅 전원 확정! 약속이 잡혔어요 — '+esc(plan.when)+' · '+esc(plan.place);
}
/* 의견 수집을 쓰지 않는 카드의 전원 투표·시간 경과 확정 */
function checkPlanDone(id,msg){
  const r=S.rooms[id]; if(!r||!msg||msg.plan.collecting)return false;
  const unanimous=(r.votes[msg.planId]||new Set()).size>=roomTotal(id);
  if((unanimous||planDue(msg.plan))&&r.plannedId!==msg.planId){
    r.planned=msg.plan; r.plannedId=msg.planId;
    if(!r.msgs.some(x=>x.confirmOf===msg.planId))r.msgs.push({f:'sys',confirmOf:msg.planId,x:planDoneMsg(unanimous?'vote':'due',msg.plan)});
    return true;
  }
  return false;
}
/* 방을 열어 둔 채 약속 시각이 지나는 순간을 놓치지 않도록 1분마다 다시 확인한다 */
let DUE_T=null;
function startDueWatch(){
  stopDueWatch();
  DUE_T=setInterval(async()=>{
    const id=CUR, r=id?S.rooms[id]:null; if(!r)return;
    const msg=[...r.msgs].reverse().find(x=>x.f==='ai');
    if(!msg||r.plannedId===msg.planId||!planDue(msg.plan))return;
    if(BACKEND){try{await sb.rpc('settle_due_plans',{p_meeting_id:id})}catch(e){}}
    if(checkPlanDone(id,msg)&&CUR===id){renderMsgs();renderBanner();toast('약속 확정','약속 시간이 지나 자동으로 확정했어요')}
  },60000);
}
function stopDueWatch(){ if(DUE_T){clearInterval(DUE_T);DUE_T=null} }
async function openRoom(id){
  if(BACKEND){
    try{if(await loadRoom(id)===false)return}catch(e){netFail('채팅방 열기');return}
    subscribeRoom(id);
  }
  restoreAvailability(id);
  CUR=id; const r=S.rooms[id];
  $('typing').style.display='none';   // 다른 방에서 돌던 입력 중 표시는 넘기지 않는다
  $('cin').value=''; updateCount();
  if(!BACKEND)r.unread=0; updateBdg();
  renderMeta(id);
  renderBanner();renderMsgs();
  $('roomview').classList.add('on');
  startDueWatch();
  if(BACKEND)await markRoomRead(id);
}
function closeRoom(){closeAvailability();$('roomview').classList.remove('on');CUR=null;stopDueWatch();$('typing').style.display='none';if(BACKEND)unsubscribeRoom();renderRooms()}
/* 첫 인사 추천 칩 — 내가 아직 아무 말도 안 한 방에서만 보인다 */
function renderOpeners(){
  const r=S.rooms[CUR], show=!!(r&&!r.msgs.some(m=>m.f==='me'));
  $('openers').innerHTML=show?OPENERS.map(t=>'<button class="chip" onclick="sendOpener(this)">'+esc(t)+'</button>').join(''):'';
  $('openers').style.display=show?'':'none';
}
function sendOpener(b){ $('cin').value=b.textContent; sendMsg(); }
/* 메시지 500자 — 400자부터 남은 글자 수를 보여 준다 */
function updateCount(){ const n=$('cin').value.length; $('cincount').textContent=n>400?n+'/500':''; }
/* 모임 나가기 — 만남 완료 전까지만. 서버가 내 투표와 참가를 함께 지운다 */
async function leaveMeeting(){
  const id=CUR, r=S.rooms[id], m=MEETINGS.find(x=>x.id===id); if(!id||!r)return;
  hidePlus();
  if(r.iAttended){toast('모임 나가기','만남을 완료한 모임은 나갈 수 없어요 · 연결이 유지돼요');return}
  if(!await askConfirm('모임에서 나갈까요?','채팅 기록이 사라지고 이 방에서 한 확정 투표도 취소돼요','나가기',true))return;
  if(BACKEND){
    const {error}=await sb.rpc('leave_meeting',{p_meeting_id:id});
    if(error){toast('모임 나가기',/완료/.test(error.message||'')?'만남을 완료한 모임은 나갈 수 없어요':'나가지 못했어요 · 다시 시도해 주세요');return}
    R.recDirty=true;
  }
  if(!BACKEND){
    try{
      localStorage.removeItem('moonlight-availability-'+id);
      const keys=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith('moonlight-poll-'))keys.push(key)}
      for(const key of keys){try{if(JSON.parse(localStorage.getItem(key))?.meeting_id===id)localStorage.removeItem(key)}catch(e){}}
    }catch(e){}
  }
  closeRoom();
  S.joined=S.joined.filter(x=>x!==id); delete S.rooms[id];
  if(!BACKEND&&m&&m.mine){m.members=m.members.filter(p=>p!=='me')}
  updateBdg(); renderRooms();
  toast('모임 나가기','<b>'+esc(m?m.name:'모임')+'</b>에서 나왔어요');
}
/* 확정 취소 — 아직 확정되지 않은 약속의 내 투표를 거둔다 */
async function unvote(i){
  const id=CUR, r=S.rooms[id], msg=r&&r.msgs[i]; if(!msg||!msg.planId||msg.plan.collecting)return;
  const set=r.votes[msg.planId]; if(!set||!set.has(MYID()))return;
  if(r.plannedId===msg.planId){toast('확정 취소','이미 확정된 약속이에요');return}
  if(BACKEND){
    const {error}=await sb.rpc('withdraw_plan_vote',{p_plan_id:msg.planId});
    if(error){toast('확정 취소',/확정/.test(error.message||'')?'이미 확정된 약속이에요':'취소하지 못했어요 · 다시 시도해 주세요');return}
    set.delete(ME);
  }else set.delete('me');
  renderMsgs(); toast('확정 취소','확정을 거뒀어요 · 다시 누르면 확정돼요');
}
/* 확정된 약속을 캘린더 파일(.ics)로 — 열면 기본 캘린더에 일정으로 들어간다 */
function addToCalendar(){
  const r=S.rooms[CUR], m=MEETINGS.find(x=>x.id===CUR), p=r&&r.planned; if(!p||!p.meetAt)return;
  const st=new Date(p.meetAt); if(isNaN(st))return; const en=new Date(st.getTime()+2*3600000);
  const f=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const clean=s=>String(s||'').replace(/[\r\n,;]/g,' ');
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MoonLight Hanwha//KO','BEGIN:VEVENT','UID:'+CUR+'@moonlight.hanwha','DTSTAMP:'+f(new Date()),
    'DTSTART:'+f(st),'DTEND:'+f(en),'SUMMARY:'+clean(m?m.name:'모임')+' · MoonLight','LOCATION:'+clean(p.place),'DESCRIPTION:'+clean(p.act),'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const a=document.createElement('a'); a.href='data:text/calendar;charset=utf-8,'+encodeURIComponent(ics); a.download='moonlight-'+CUR+'.ics';
  document.body.appendChild(a); a.click(); a.remove();
  toast('캘린더','약속을 캘린더 파일로 내려받았어요 · 열면 일정에 추가돼요');
}
/* 아는 얼굴과 다음 모임 — 만들기 시트를 열고 그 사람을 미리 초대해 둔다 */
function inviteNext(pid){ hideMembers(); closeRoom(); go('match'); openCreate(); cinv(pid); toast('다음 모임','<b>'+esc((PEOPLE[pid]||{}).real||'친구')+'</b> 님을 초대 목록에 담았어요'); }
/* 매칭 카드의 "채팅방 열기" — 채팅 탭으로 옮기면서 그 방을 바로 연다 */
function openJoined(id){go('chat');openRoom(id)}
/* + 메뉴 "모임 정보" — 직접 만든 모임과 추천 모임을 구분해 안내한다 */
function showMeetingInfo(){
  const m=MEETINGS.find(x=>x.id===CUR); if(!m)return;
  const meta=esc(m.region||'')+' · '+esc(m.when||'')+' · 정원 '+m.cap+'명';
  toast('모임 정보',m.mine?'<b>내가 만든 모임</b> · '+meta:meta+' · 매칭 탭 AI 추천으로 열린 모임이에요');
}
function renderBanner(){
  const r=S.rooms[CUR]; if(!r)return;
  const total=roomTotal(CUR), n=r.attended.size;
  let h='';
  if(r.iAttended) h='🌕 만남 완료 '+n+'/'+total+(n>=total?' · 모두 완료! 베일이 벗겨졌어요':' · 함께 완료한 동료부터 실명으로 보여요');
  else if(r.planned) h=(r.planned.meetAt?'<button class="cal" onclick="addToCalendar()" aria-label="캘린더에 추가">'+ico('cal')+'</button>':ico('cal'))
    +'<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.planned.when)+' · '+esc(r.planned.place)+'</span><button onclick="doReveal()">만남 완료</button>';
  $('rbanner').innerHTML=h; $('rbanner').classList.toggle('on',!!h);
}
function renderMsgs(){
  const r=S.rooms[CUR], ms=r.msgs;
  const who=m=>(m.f==='sys'||m.f==='ai')?null:m.f;   // 묶음 기준 발신자 (시스템·AI 카드는 묶지 않는다)
  const lastAi=[...ms].reverse().find(m=>m.f==='ai');   // 최신 제안만 살아 있고, 대체된 카드는 회색으로 남긴다
  let lastDk=null;
  $('msgs').innerHTML=ms.map((m,i)=>{
    const prev=ms[i-1], next=ms[i+1];
    const cont=!!(prev&&who(m)&&who(prev)===who(m));   // 같은 사람의 연속 메시지 — 아바타·이름을 생략한다
    const tail=!(next&&who(m)&&who(next)===who(m));    // 묶음의 마지막에만 시간을 붙인다
    const tm=tail&&m.t?'<time>'+esc(m.t)+'</time>':'';
    let div='';
    if(m.dk&&m.dk!==lastDk){lastDk=m.dk;div='<div class="msg date"><span>'+esc(dateLabel(m.dk))+'</span></div>'}   // 날짜가 바뀌면 구분선
    if(m.f==='sys')return div+'<div class="msg sys"><div class="bub">'+esc(m.x)+'</div></div>';   // 닉네임·LLM 텍스트가 섞이므로 반드시 이스케이프
    if(m.f==='me')return div+'<div class="msg me'+(cont?' cont':'')+'"><div><div class="bub">'+esc(m.x)+'</div></div>'+tm+'</div>';
    if(m.f==='ai'){
      const p=m.plan, total=roomTotal(CUR), set=r.votes[m.planId]||new Set(), votes=set.size, mine=set.has(MYID());
      const stale=m!==lastAi&&r.plannedId!==m.planId;   // 새 제안으로 대체된 카드
      const unanimous=!p.collecting&&votes>=total, auto=planDue(p)&&!unanimous;   // auto: 투표가 다 안 찼는데 시간이 지나 확정된 카드
      const done=r.plannedId===m.planId||unanimous||auto, pct=auto?100:Math.min(100,Math.round(votes/total*100));
      // 후보지: 지도 + 목록. 목록과 Marker 선택은 selectCand 로 양방향 동기화된다
      const note=searchNoteHtml(m.search);   // 검색 결과 없음·할당량 초과·오류 안내
      const cands=(p.cands||[]).length
        ? '<div class="cands"><b>후보지 · '+(BACKEND?'실제 장소 검색 결과 ':'데모 후보 ')+p.cands.length+'곳</b>'
          +planMapHtml(m.planId,p.cands)+candListHtml(m.planId,p.cands,done||p.collecting||stale||!p.schedule)+note+'</div>'
        : (note?'<div class="cands">'+note+'</div>':'');
      const btn=stale
        ?'<button disabled>새 제안으로 대체됐어요</button>'
        :'<button '+(p.collecting||(!p.schedule&&!done)?'hidden ':'')+(done||mine||(p.schedule&&!p.schedule.selected)?'disabled':'')+' onclick="confirmPlan('+i+')">'+(auto?'시간이 지나 확정됨':done?'약속 확정됨':mine?'확정했어요 ✓ · 다른 멤버 기다리는 중':'이 약속으로 확정')+'</button>'
          +(mine&&!done&&!p.collecting?'<button class="unvote" onclick="unvote('+i+')">확정 취소</button>':'');
      return div+'<div class="msg aimsg"><div class="mav">🌙</div><div><div class="who" style="color:var(--orange-soft)">MoonLight AI'+(m.source==='fallback'?' <small>기본 제안</small>':'')+(stale?' <small>이전 제안</small>':'')+'</div>'
        +'<div class="bub plan'+(stale?' stale':'')+'"><h4>'+ico('spark')+'AI 추천 약속</h4>'
        +'<div class="row"><i>📍</i><span><b>'+esc(p.place)+'</b></span></div>'
        +'<div class="row"><i>🕖</i><span>'+esc(p.when)+'</span></div>'
        +'<div class="row"><i>🎯</i><span>'+esc(p.act)+'</span></div>'
        +'<div class="row"><i>🍜</i><span>'+esc(p.food)+'</span></div>'
        +cands
        +(!p.collecting&&!done&&!stale?'<button class="cta" onclick="openRoomPoll()">약속 잡기 · 시간과 장소</button>':'')
        +'<button '+(!p.schedule||p.collecting||stale?'hidden ':'')+'class="cta line" onclick="openAvailability(\''+m.planId+'\')">가능 시간 조율</button>'
        +(p.collecting?'<button onclick="loadPoll(\''+p.pollId+'\')">'+(done?'확정 결과 · 내 의견 보기':'의견 제출 · 방장 비교 화면')+'</button>':'')
        +'<div class="vote"'+(p.collecting||(!p.schedule&&!done)?' hidden':'')+'><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div>'
        +'<div class="lb"><span>'+(auto?'<b>시간 지나 자동 확정 🌕</b>':done?'<b>전원 확정 🌕</b>':'확정 <b>'+votes+'</b> / '+total+'명')+'</span>'
        +'<span>'+(stale?'이전 제안이에요':auto?'약속 시간이 지났어요':done?'약속이 잡혔어요':'모두 누르면 확정돼요')+'</span></div></div>'
        +btn
        +'</div></div></div>';
    }
    const p=PEOPLE[m.f]||UNKNOWN;
    return div+'<div class="msg'+(cont?' cont':'')+'"><div class="mav">'+esc(p.av||'🌙')+'</div><div>'+(cont?'':'<div class="who">'+label(m.f,r)+'</div>')+'<div class="bub">'+esc(m.x)+'</div></div>'+tm+'</div>';
  }).join('');
  mountPlanMaps();   // 새로 그려진 지도 컨테이너에 카카오맵을 붙인다 (placeholder 모드에서는 아무 일도 하지 않는다)
  renderOpeners();
  $('msgs').scrollTop=$('msgs').scrollHeight;
}
async function sendMsg(){
  const v=$('cin').value.trim(); if(!v||!CUR)return;
  const r=S.rooms[CUR];
  if(BACKEND){
    const body=v.slice(0,500); $('cin').value=''; updateCount();   // 메시지 500자 제한
    const {data,error}=await sb.from('messages').insert({meeting_id:CUR,sender_id:ME,body}).select('id,sender_id,body,created_at').single();
    if(error){netFail('메시지 전송');$('cin').value=body;return}
    if(pushMsg(r,data))renderMsgs();   // Realtime으로 같은 메시지가 와도 id로 한 번만 그린다
    return;
  }
  r.msgs.push({f:'me',x:v,t:nowT(),dk:dayKey()});
  $('cin').value=''; updateCount(); renderMsgs();
  const m=MEETINGS.find(x=>x.id===CUR);
  if(!m.members.length)return;   // 아직 멤버가 없는 방(직접 만든 모임)은 답장 시뮬레이션 없음
  const pid=m.members[Math.floor(Math.random()*m.members.length)];
  showTyping(pid, r, ()=>{
    r.msgs.push({f:pid,x:REPLIES[Math.floor(Math.random()*REPLIES.length)],t:nowT(),dk:dayKey()});
    if(CUR)renderMsgs();
  });
}
function showTyping(pid,room,cb){
  const p=PEOPLE[pid]||UNKNOWN;
  $('typing').style.display='block';
  $('typing').textContent=(S.met[pid]&&p.real?p.real:p.nick)+' 님이 입력 중…';   // 실명은 서로 만남 완료한 사람만
  setTimeout(()=>{$('typing').style.display='none';cb()},1100+Math.random()*900);
}

/* + 메뉴 */
function openPlus(){
  $('pollMenuIcon').innerHTML=ico('cal');
  const r=S.rooms[CUR];
  $('plusAlbum').disabled=!r.iAttended;
  $('plusRate').disabled=!r.iAttended;
  $('plusLeave').disabled=r.iAttended;   // 만남 완료 후에는 나갈 수 없다
  const ai=[...r.msgs].reverse().find(m=>m.f==='ai');
  $('plusAiLbl').textContent='약속 잡기 · 시간과 장소';
  $('pluswrap').classList.add('on');
}
function hidePlus(){$('pluswrap').classList.remove('on')}
async function aiPlan(){return openRoomPoll()}
/* 후보 날짜를 정한 뒤 현재 방의 대화로 장소를 추천받는다. */
async function recommendPollPlaces(id){
  const r=S.rooms[id],mm=MEETINGS.find(m=>m.id===id);
  if(r.planPending)throw Error('장소를 추천하는 중이에요');
  r.planPending=true;
  try{
    if(BACKEND){
      const d=await callFn('suggest-meeting-plan',{meeting_id:id}),pl=d.plan;
      applyPlan(r,{...pl,time_label:pl.time,confirmed:false,source:d.fallback?'fallback':'llm'},d.search);
      if(d.fallback)toast('기본 장소 후보','대화 분석이 지연되어 일반 식당·카페 후보가 포함될 수 있어요');
      if(!pl.candidates?.length)throw Error(SEARCH_TOAST[d.search?.status]||'장소를 찾지 못했어요. 잠시 후 다시 시도해 주세요');
      return r.msgs.find(m=>m.planId===pl.id);
    }
    // 네트워크 없는 데모는 실재 장소나 LLM 결과로 오해하지 않도록 명시한다.
    const text=r.msgs.filter(m=>m.f!=='sys'&&m.f!=='ai').slice(-30).map(m=>m.x||'').join(' ');
    const food=text.includes('닭발')?'닭발 식당':'식당';
    const cands=[{name:(mm.region||'근처')+' 데모 '+food,address:'데모 후보 · 실제 검색 결과가 아니에요',why:'로컬 데모 예시예요'},
      {name:(mm.region||'근처')+' 데모 카페',address:'데모 후보 · 실제 검색 결과가 아니에요',why:'대화하기 좋은 장소 예시예요'}];
    const planId='local-'+crypto.randomUUID();
    const msg={f:'ai',planId,source:'fallback',plan:{place:cands[0].name,when:'가능 시간 조율 중',act:'함께 만나 이야기해요',food:'',cands,meetAt:null},t:nowT()};
    r.msgs.push(msg);return msg;
  }catch(e){
    const messages={RATE_LIMITED:'AI 약속 추천 한도에 도달했어요. 기존 약속을 이용하거나 잠시 후 다시 시도해 주세요',NOT_HOST:'방장이 약속 잡기를 시작하면 시간과 장소를 선택할 수 있어요',NOT_MEMBER:'이 모임에 참가한 뒤 다시 시도해 주세요',UNAUTHORIZED:'세션이 만료됐어요. 다시 로그인해 주세요'};
    if(e.code)throw new Error(messages[e.code]||'장소 추천에 연결하지 못했어요. 잠시 후 다시 시도해 주세요');
    throw e;
  }finally{r.planPending=false;if(CUR===id){renderMsgs();renderBanner()}}
}
/* 확정 = 투표. 채팅방 인원 전원이 눌러야 약속이 잡힌다 */
async function confirmPlan(i){
  const id=CUR, r=S.rooms[id], msg=r.msgs[i]; if(!msg||!msg.planId||msg.plan.collecting)return;
  if(msg.plan.schedule&&!msg.plan.schedule.selected){toast('시간 조율','방장이 시간을 먼저 선택해 주세요');return}
  const set=r.votes[msg.planId]||(r.votes[msg.planId]=new Set());
  if(set.has(MYID()))return;
  if(BACKEND){
    const {error}=await sb.from('meeting_plan_votes').upsert({plan_id:msg.planId,meeting_id:id,user_id:ME},{onConflict:'plan_id,user_id',ignoreDuplicates:true});
    if(error){netFail('약속 확정');return}
    set.add(ME); checkPlanDone(id,msg); renderMsgs(); renderBanner();
    toast('확정 투표','채팅방 멤버 모두가 누르면 약속이 잡혀요');
    return;
  }
  set.add('me');checkPlanDone(id,msg);persistAvailability(id); renderMsgs();renderBanner();
  toast('확정 투표','다른 멤버들의 확정을 기다려요');
  simulatePlanVotes(id,msg);
}
/* 새로고침 뒤에도 데모의 진행 중 확정 투표를 이어 간다. */
function simulatePlanVotes(id,msg){
  const m=MEETINGS.find(x=>x.id===id);
  m.members.forEach((pid,k)=>setTimeout(()=>{
    const rr=S.rooms[id]; if(!rr)return;
    (rr.votes[msg.planId]||(rr.votes[msg.planId]=new Set())).add(pid);
    const done=checkPlanDone(id,msg);persistAvailability(id);
    if(CUR===id){renderMsgs();renderBanner()}
    if(done)toast('약속 확정','전원이 확정했어요 · 만난 뒤 각자 만남 완료를 눌러 주세요');
  },1300*(k+1)));
}

/* ================= 베일 벗기기 ================= */
function placeholderPhotos(m){
  // 발표 단계 사진첩은 플레이스홀더만 (실제 업로드는 파일럿 이후 범위)
  return [
    {g:'linear-gradient(140deg,#F37321,#8B5CF6)',l:'첫 만남 단체샷'},
    {g:'linear-gradient(140deg,#17A67C,#2BB3C0)',l:(m.tags[0]||'모임')+' 하는 중'},
    {g:'linear-gradient(140deg,#E8B84B,#E86A8A)',l:'다 같이 한 컷'},
    {g:'linear-gradient(140deg,#5A9CF3,#B49BE0)',l:'다음에 또 만나요'},
  ];
}
/* 만남 완료 = 개인별 체크인. 나와 상대가 둘 다 완료했을 때만 서로의 실명이 보인다 (각자 다르게 보임) */
async function doReveal(){
  const id=CUR, m=MEETINGS.find(x=>x.id===id), r=S.rooms[id];
  if(!r||r.iAttended)return;
  let res=null;
  if(BACKEND){
    // 서버가 내 출석을 기록하고, 이미 완료한 멤버와의 연결을 만든다 (멱등)
    try{res=await callFn('complete-meeting',{meeting_id:id})}
    catch(e){
      // 약속이 확정되기 전부터 멤버였어야 체크인할 수 있다 (#11) — 실명은 실제로 만난 사람에게만
      if(e.code==='PLAN_NOT_CONFIRMED')toast('만남 완료','확정된 약속이 있어야 만남 완료를 누를 수 있어요');
      else if(e.code!=='UNAUTHORIZED')toast('만남 완료','처리에 실패했어요 · 다시 시도해 주세요');
      return;
    }
  }
  $('veiltxt').textContent='만남을 완료했어요. 함께 완료한 동료부터 이름이 보여요';
  $('veil').classList.add('on');
  setTimeout(async()=>{
    $('veil').classList.remove('on');
    r.attended.add(MYID()); r.iAttended=true;
    if(!r.photos.length)r.photos=placeholderPhotos(m);
    if(BACKEND){
      await Promise.all([loadConnections(),loadRooms()]);
      await openRoom(id);
      const rr=S.rooms[id], others=res?Math.max(0,res.attended_count-1):rr.attended.size-1;
      rr.msgs.push({f:'sys',x:'🌕 만남 완료 '+(res?res.attended_count:rr.attended.size)+'/'+(res?res.member_count:roomTotal(id))+(others>0?' — 함께 완료한 동료의 이름이 보여요':' — 다른 멤버도 완료하면 서로 이름이 보여요')});
      renderMsgs();renderBanner();renderMeta(id);
      toast(others>0?'커넥션 활성화':'만남 완료',others>0?'함께 완료한 동료 '+others+'명 · 홈에서 행성을 확인해 보세요 ✨':'상대가 완료하면 실명으로 바뀌어요');
      setTimeout(()=>{if(CUR===id)openRating(id)},900);   // 만남 평가 (별 0.5~5)
      return;
    }
    // 로컬 데모: 다른 멤버들이 차례로 완료하는 상황을 시뮬레이션 — 완료한 사람부터 실명이 보인다
    r.msgs.push({f:'sys',x:'🌕 만남을 완료했어요 — 다른 멤버가 완료하면 서로 이름이 보여요'});
    if(CUR===id){renderMsgs();renderBanner();renderMeta(id)}
    setTimeout(()=>{if(CUR===id)openRating(id)},900);   // 만남 평가 (별 0.5~5)
    m.members.forEach((pid,k)=>setTimeout(()=>{
      const rr=S.rooms[id]; if(!rr)return;
      rr.attended.add(pid); S.met[pid]=true;
      const p=PEOPLE[pid], c=co(p.co);
      rr.msgs.push({f:'sys',x:'🌕 '+p.nick+' 님이 만남을 완료했어요 — 이제 '+p.real+'('+(c?c.name:'')+')으로 보여요'});
      if(CUR===id){renderMsgs();renderBanner();renderMeta(id)}
      if(k===m.members.length-1)toast('커넥션 활성화','모두 완료! 새 행성이 빛나기 시작했어요 ✨');
    },1800*(k+1)));
  },2600);
}

/* ================= 사진첩 ================= */
function openAlbumBtn(){if(S.rooms[CUR].iAttended)openAlbum()}
function openAlbum(){
  const m=MEETINGS.find(x=>x.id===CUR), r=S.rooms[CUR];
  if(!r.iAttended)return;
  if(!r.photos.length)r.photos=placeholderPhotos(m);
  $('albTitle').textContent=m.name+' 사진첩';
  $('pgrid').innerHTML=r.photos.map(p=>'<div class="photo" style="background:'+p.g+'"><span class="sample">샘플</span>'+esc(p.l)+'</div>').join('')
    +'<button class="photo" style="background:var(--card);border:1.5px dashed var(--line);align-items:center;justify-content:center;color:var(--tx3);box-shadow:none" onclick="toast(\'사진 추가\',\'사진 업로드는 발표 이후 파일럿에서 지원돼요\')">＋ 사진 추가</button>';
  $('album').classList.add('on');
}
function closeAlbum(){$('album').classList.remove('on')}


/* ================= 만남 평가 (별 0.5~5 · 매칭 학습용 데이터) ================= */
const RT={id:null,val:0};
const RATE_TXT={1:'많이 아쉬웠어요',2:'아쉬웠어요',3:'조금 아쉬웠어요',4:'그냥 그랬어요',5:'보통이에요',6:'괜찮았어요',7:'좋았어요',8:'꽤 좋았어요',9:'아주 좋았어요',10:'최고였어요!'};
function openRating(id){
  const r=S.rooms[id]; if(!id||!r||!r.iAttended)return;
  RT.id=id; RT.val=r.myRating||0; $('ratecmt').value=''; $('rateerr').textContent='';
  renderStars(); $('ratewrap').classList.add('on');
}
function hideRating(){$('ratewrap').classList.remove('on')}
function setRate(v){RT.val=v;renderStars()}
function renderStars(){
  $('ratestars').innerHTML=[1,2,3,4,5].map(n=>{
    const w=RT.val>=n?100:RT.val>=n-.5?50:0;
    return '<div class="star">★<span class="fillc" style="width:'+w+'%">★</span>'
      +'<button class="l" aria-label="'+(n-.5)+'점" onclick="setRate('+(n-.5)+')"></button>'
      +'<button class="r" aria-label="'+n+'점" onclick="setRate('+n+')"></button></div>';
  }).join('');
  $('rateval').innerHTML=RT.val?'<b>'+RT.val.toFixed(1)+'</b> / 5.0 · '+RATE_TXT[Math.round(RT.val*2)]:'별을 눌러 주세요 · 별의 왼쪽 반을 누르면 0.5점';
  $('ratebtn').disabled=!RT.val;
}
async function submitRating(){
  const id=RT.id, r=S.rooms[id]; if(!id||!RT.val)return;
  const comment=$('ratecmt').value.trim().slice(0,120);
  const btn=$('ratebtn'); btn.disabled=true; btn.textContent='보내는 중…';
  try{
    if(BACKEND){
      // 트리거가 모임·프로필·연결 특성 스냅샷(features)을 함께 저장한다
      const {error}=await sb.from('meeting_feedback').upsert({meeting_id:id,user_id:ME,rating:RT.val,comment:comment||null},{onConflict:'meeting_id,user_id'});
      if(error)throw error;
    }else S.feedback[id]={rating:RT.val,comment};
    if(r)r.myRating=RT.val;
    hideRating(); toast('평가 완료','별 '+RT.val.toFixed(1)+' · 매칭 학습 데이터로 저장했어요');
  }catch(e){ $('rateerr').textContent='평가를 저장하지 못했어요 · 다시 시도해 주세요' }
  finally{btn.disabled=!RT.val;btn.textContent='평가 보내기'}
}

