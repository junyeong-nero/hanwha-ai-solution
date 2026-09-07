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
    const isAi=last.f==='ai', lastTxt=isAi?'새 장소 후보가 도착했어요':(last.x||'');
    const right=r.unread?'<span class="ub">'+r.unread+'</span>':r.msgs.some(m=>m.f==='ai')?'<span class="pl">'+ico('pin')+' 장소 후보</span>':'';
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
/* 채팅방 멤버 보기: 표시 이름 · 만남 완료 여부 */
async function openMembers(){
  const id=CUR; if(!id)return;
  if(BACKEND)await refreshMembers(id);
  const m=MEETINGS.find(x=>x.id===id), r=S.rooms[id]; if(!m||!r)return;
  const P=S.profile, myCo=co(P.company);
  const rows=[{id:MYID(),av:P.av,name:P.realName||P.nick,sub:(myCo?myCo.name:'')+' · 나 ('+P.nick+')',me:true,ints:[...P.interests,...P.hobbies]}]
    .concat(m.members.map(pid=>{const p=PEOPLE[pid]||UNKNOWN, c=co(p.co), known=!!(S.met[pid]&&p.real);
      return {id:pid,av:p.av,name:known?p.real:p.nick,sub:known?(c?c.name:''):'익명 · 만남 완료 후 실명이 보여요',known,ints:p.ints||[]};}));
  $('memlist').innerHTML=rows.map(x=>{
    const att=r.attended.has(x.id);
    // 관심사 태그는 익명 상태에서도 보인다 — 실명·사번 없이 대화 소재만
    const tags=x.ints.length?'<span class="mtags">'+x.ints.slice(0,3).map(t=>'<i>#'+esc(t)+'</i>').join('')+'</span>':'';
    return '<div class="memrow"><div class="mav">'+esc(x.av||'🌙')+'</div><div class="nm"><b>'+esc(x.name)+(x.me?' <small style="color:var(--orange)">ME</small>':'')+'</b><small>'+esc(x.sub)+'</small>'+tags+'</div>'
      +'<div class="bd">'+(x.known?'<button class="inv" onclick="inviteNext(\''+x.id+'\')">다음 모임</button>':'')
      +'<span class="mbadge'+(att?' full':'')+'">'+(att?'만남 완료':'만남 전')+'</span></div></div>';
  }).join('');
  const total=roomTotal(id), anon=m.members.filter(p=>!S.met[p]).length;
  $('memsum').textContent='멤버 '+total+'명 · 익명 '+anon+'명'+' · 만남 완료 '+r.attended.size+'/'+total;
  $('memwrap').classList.add('on');
}
function hideMembers(){$('memwrap').classList.remove('on')}
async function openRoom(id){
  if(BACKEND){
    try{if(await loadRoom(id)===false)return}catch(e){netFail('채팅방 열기');return}
    subscribeRoom(id);
  }
  CUR=id; const r=S.rooms[id];
  $('typing').style.display='none';   // 다른 방에서 돌던 입력 중 표시는 넘기지 않는다
  $('cin').value=''; updateCount();
  if(!BACKEND)r.unread=0; updateBdg();
  renderMeta(id);
  renderBanner();renderMsgs();
  $('roomview').classList.add('on');
  if(BACKEND)await markRoomRead(id);
}
function closeRoom(){$('roomview').classList.remove('on');CUR=null;$('typing').style.display='none';if(BACKEND)unsubscribeRoom();renderRooms()}
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
  if(!await askConfirm('모임에서 나갈까요?','채팅 기록이 사라져요','나가기',true))return;
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
  else h='<span>대화에 맞는 장소가 궁금하다면</span><button onclick="aiPlan()" '+(r.planPending?'disabled':'')+'>'+ico('spark')+(r.planPending?'추천 중…':'AI 장소 추천')+'</button>';
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
      return div+placeRecommendationHtml(m,m!==lastAi);
    }

    const p=PEOPLE[m.f]||UNKNOWN;
    return div+'<div class="msg'+(cont?' cont':'')+'"><div class="mav">'+esc(p.av||'🌙')+'</div><div>'+(cont?'':'<div class="who">'+label(m.f,r)+'</div>')+'<div class="bub">'+esc(m.x)+'</div></div>'+tm+'</div>';
  }).join('');
  $('msgs').innerHTML+=placeRequestStatusHtml(r);
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
  $('placeMenuIcon').innerHTML=ico('spark');
  $('revealMenuIcon').innerHTML=ico('check');
  const r=S.rooms[CUR];
  $('plusAlbum').disabled=!r.iAttended;
  $('plusRate').disabled=!r.iAttended;
  $('plusLeave').disabled=r.iAttended;   // 만남 완료 후에는 나갈 수 없다
  $('plusReveal').disabled=r.iAttended;
  $('plusAi').disabled=!!r.planPending;
  $('plusAiLbl').textContent=r.planPending?'장소를 추천하고 있어요…':'AI 장소 추천';
  $('pluswrap').classList.add('on');
}
function hidePlus(){$('pluswrap').classList.remove('on')}
/* 기존 함수 이름을 유지하되, 추천 후보만 요청한다. */
async function aiPlan(){
  const id=CUR,r=S.rooms[id];if(!r||r.planPending)return;
  hidePlus();r.planError='';
  let recommended;
  try{recommended=await recommendPollPlaces(id)}catch(e){if(S.rooms[id]===r)r.planError=e.message||'연결을 확인하고 다시 시도해 주세요'}
  if(CUR===id&&S.rooms[id]===r){
    renderMsgs();renderBanner();
    if(recommended&&document.activeElement!==$('cin'))$('rec-'+recommended.planId).scrollIntoView({block:'start'});
  }
}
async function recommendPollPlaces(id){
  const r=S.rooms[id],mm=MEETINGS.find(m=>m.id===id);
  if(!r||r.planPending)throw Error('장소를 추천하는 중이에요');
  r.planPending=true;
  if(CUR===id){renderMsgs();renderBanner()}
  try{
    let msg;
    if(BACKEND){
      const epoch=backendEpoch;
      const d=await callFn('suggest-meeting-plan',{meeting_id:id}),pl=d.plan;
      if(epoch!==backendEpoch||S.rooms[id]!==r)return;
      if(!pl?.candidates?.length)throw Error(SEARCH_TOAST[d.search?.status]||'장소를 찾지 못했어요. 다른 지역이나 음식 이야기를 남기고 다시 시도해 주세요');
      applyPlan(r,{...pl,time_label:'',confirmed:false,source:d.fallback?'fallback':'llm'},d.search);
      msg=r.msgs.find(m=>m.planId===pl.id);
    }else{
      // 네트워크 없는 데모 예시. 실제 검색 결과나 대화 이해 결과로 표시하지 않는다.
      const text=r.msgs.filter(m=>m.f!=='sys'&&m.f!=='ai').slice(-30).map(m=>m.x||'').join(' ');
      const spicy=text.includes('닭발'),region=mm.region||'근처';
      const cands=[
        {name:region+' 데모 '+(spicy?'닭발 식당':'식당'),category:spicy?'닭발':'식당',address:region+' · 가상의 데모 장소',why:spicy?'대화에 나온 ‘닭발’을 반영한 식당 예시예요.':'모임 지역에서 함께 식사할 수 있는 후보 예시예요.'},
        {name:region+' 데모 카페',category:'카페',address:region+' · 가상의 데모 장소',why:'식사 후에도 이야기를 이어갈 카페 후보 예시예요.'},
        {name:region+' 데모 티룸',category:'찻집',address:region+' · 가상의 데모 장소',why:'식사 대신 차를 마시며 만나는 선택지도 비교해 볼 수 있어요.'}
      ];
      msg={f:'ai',planId:'local-'+crypto.randomUUID(),source:'demo',plan:{cands,meetAt:null,recommendationOnly:true},t:nowT(),dk:dayKey()};
      r.msgs.push(msg);
    }
    if(msg)S.placeRecommendationTried=true;
    return msg;
  }catch(e){
    const messages={RATE_LIMITED:'AI 장소 추천 한도에 도달했어요. 기존 후보를 비교하거나 잠시 후 다시 시도해 주세요',NOT_MEMBER:'이 모임에 참가한 뒤 다시 시도해 주세요',UNAUTHORIZED:'세션이 만료됐어요. 다시 로그인해 주세요'};
    if(e.code)throw new Error(messages[e.code]||'장소 추천에 연결하지 못했어요. 잠시 후 다시 시도해 주세요');
    throw e;
  }finally{r.planPending=false;if(CUR===id&&S.rooms[id]===r){renderMsgs();renderBanner()}}
}
/* 이전 인라인 호출도 더 이상 투표를 만들지 않는다. */
function confirmPlan(){toast('장소 후보','마음에 드는 곳을 채팅에서 이야기해 보세요')}

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
  hidePlus();
  if(!await askConfirm('실제로 함께 만나셨나요?','나와 상대가 모두 만남 완료를 누르면 서로의 실명과 계열사가 공개돼요.','만남 완료'))return;
  if(CUR!==id||S.rooms[id]!==r)return;
  let res=null;
  if(BACKEND){
    // 서버가 내 출석을 기록하고, 이미 완료한 멤버와의 연결을 만든다 (멱등)
    try{res=await callFn('complete-meeting',{meeting_id:id})}
    catch(e){
      // 첫 만남 완료 이후 들어온 멤버의 실명 공개는 서버에서 차단한다.
      if(e.code==='ATTENDANCE_CLOSED')toast('만남 완료','이 방의 첫 만남 완료 이후 참가했어요. 다음 모임에서 함께 만나요');
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

