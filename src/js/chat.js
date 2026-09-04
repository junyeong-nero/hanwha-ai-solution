/* ================= 채팅 리스트 ================= */
function updateBdg(){
  const n=Object.values(S.rooms).reduce((s,r)=>s+r.unread,0);
  $('chatbdg').style.display=n?'flex':'none';$('chatbdg').textContent=n;
}
function renderRooms(){
  if(!S.joined.length){
    $('roomlist').innerHTML='<div class="empty"><i>🌘</i>아직 참여한 모임이 없어요.<br>매칭 탭에서 마음에 드는 모임에 참가해 보세요.</div>';return;
  }
  $('roomlist').innerHTML=S.joined.map(id=>{
    const m=MEETINGS.find(x=>x.id===id), r=S.rooms[id];
    if(!m||!r)return '';
    const last=r.msgs.length?r.msgs[r.msgs.length-1]:{x:r.last||'대화를 시작해 보세요',t:r.lastT||''};
    const lastTxt=last.f==='ai'?'🌙 AI가 약속을 제안했어요':(last.x||'');
    return '<button class="room" onclick="openRoom(\''+id+'\')">'
      +'<span class="av">'+m.em+(r.iAttended?'<span class="full">🌕</span>':'')+'</span>'
      +'<span class="bd"><span class="r1"><b>'+esc(m.name)+'<small>'+(memberTotal(m)+1)+'</small></b><time>'+(last.t||'')+'</time></span>'
      +'<span class="r2"><p>'+esc(String(lastTxt)).slice(0,44)+'</p>'+(r.unread?'<span class="ub">'+r.unread+'</span>':'')+'</span></span></button>';
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
  const rows=[{id:MYID(),av:P.av,name:P.realName||P.nick,sub:(myCo?myCo.name:'')+' · 나 ('+P.nick+')',me:true}]
    .concat(m.members.map(pid=>{const p=PEOPLE[pid]||UNKNOWN, c=co(p.co), known=!!(S.met[pid]&&p.real);
      return {id:pid,av:p.av,name:known?p.real:p.nick,sub:known?(c?c.name:''):'익명 · 만남 완료 후 실명이 보여요',known};}));
  $('memlist').innerHTML=rows.map(x=>{
    const att=r.attended.has(x.id), voted=!!(votes&&votes.has(x.id));
    return '<div class="memrow"><div class="mav">'+x.av+'</div><div class="nm"><b>'+esc(x.name)+(x.me?' <small style="color:var(--orange)">ME</small>':'')+'</b><small>'+esc(x.sub)+'</small></div>'
      +'<div class="bd">'+(ai?'<span class="mbadge'+(voted?' on':'')+'">'+(voted?'확정 ✓':'미확정')+'</span>':'')
      +'<span class="mbadge'+(att?' full':'')+'">'+(att?'만남 완료':'만남 전')+'</span></div></div>';
  }).join('');
  const total=roomTotal(id), anon=m.members.filter(p=>!S.met[p]).length;
  $('memsum').textContent='멤버 '+total+'명 · 익명 '+anon+'명'+(ai?' · 확정 '+(votes?votes.size:0)+'/'+total:'')+' · 만남 완료 '+r.attended.size+'/'+total;
  $('memwrap').classList.add('on');
}
function hideMembers(){$('memwrap').classList.remove('on')}
/* 약속 시각이 지났는지. meetAt 이 없는 카드("평일 저녁"처럼 날짜를 짚을 수 없는 문구)는 항상 false */
function planDue(plan){ const t=plan&&plan.meetAt?Date.parse(plan.meetAt):NaN; return Number.isFinite(t)&&t<=Date.now() }
function planDoneMsg(reason,plan){
  return reason==='due'
    ? '🌕 약속 시간이 지나 자동으로 확정했어요 — '+esc(plan.when)+' · '+esc(plan.place)+' · 만나셨다면 만남 완료를 눌러 주세요'
    : '📅 전원 확정! 약속이 잡혔어요 — '+esc(plan.when)+' · '+esc(plan.place);
}
/* 확정 경로는 둘 — 전원이 확정 투표를 했거나, 약속 시각이 지났거나 */
function checkPlanDone(id,msg){
  const r=S.rooms[id]; if(!r||!msg)return false;
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
    try{await loadRoom(id)}catch(e){netFail('채팅방 열기');return}
    subscribeRoom(id);
  }
  CUR=id; const r=S.rooms[id];
  r.unread=0; updateBdg();
  renderMeta(id);
  renderBanner();renderMsgs();
  $('roomview').classList.add('on');
  startDueWatch();
}
function closeRoom(){$('roomview').classList.remove('on');CUR=null;stopDueWatch();if(BACKEND)unsubscribeRoom();renderRooms()}
function renderBanner(){
  const r=S.rooms[CUR]; if(!r)return;
  const total=roomTotal(CUR), n=r.attended.size;
  let h='';
  if(r.iAttended) h='🌕 만남 완료 '+n+'/'+total+(n>=total?' · 모두 완료! 베일이 벗겨졌어요':' · 함께 완료한 동료부터 실명으로 보여요');
  else if(r.planned) h='📅 '+esc(r.planned.when)+' · '+esc(r.planned.place)+'<button onclick="doReveal()">만남 완료</button>';
  $('rbanner').innerHTML=h; $('rbanner').classList.toggle('on',!!h);
}
function renderMsgs(){
  const r=S.rooms[CUR];
  $('msgs').innerHTML=r.msgs.map((m,i)=>{
    if(m.f==='sys')return '<div class="msg sys"><div class="bub">'+esc(String(m.x||''))+'</div></div>';   // 닉네임·LLM 텍스트가 섞이므로 반드시 이스케이프
    if(m.f==='me')return '<div class="msg me"><div><div class="bub">'+esc(m.x)+'</div></div></div>';
    if(m.f==='ai'){
      const p=m.plan, total=roomTotal(CUR), set=r.votes[m.planId]||new Set(), votes=set.size, mine=set.has(MYID());
      const unanimous=votes>=total, auto=planDue(p)&&!unanimous;   // auto: 투표가 다 안 찼는데 시간이 지나 확정된 카드
      const done=r.plannedId===m.planId||unanimous||auto, pct=auto?100:Math.min(100,Math.round(votes/total*100));
      const cands=(p.cands||[]).map(c=>'<div class="cand"><a href="'+esc(c.url||'#')+'" target="_blank" rel="noopener">'+esc(c.name||'')+'</a>'
        +(c.address?'<small>'+esc(c.address)+'</small>':'')+(c.why?'<em>'+esc(c.why)+'</em>':'')+'</div>').join('');
      return '<div class="msg"><div class="mav">🌙</div><div><div class="who" style="color:var(--orange-soft)">MoonLight AI'+(m.source==='fallback'?' <small>기본 제안</small>':'')+'</div>'
        +'<div class="bub plan"><h4>🌙 AI 추천 약속</h4>'
        +'<div class="row"><i>📍</i><span><b>'+esc(p.place)+'</b></span></div>'
        +'<div class="row"><i>🕖</i><span>'+esc(p.when)+'</span></div>'
        +'<div class="row"><i>🎯</i><span>'+esc(p.act)+'</span></div>'
        +'<div class="row"><i>🍜</i><span>'+esc(p.food)+'</span></div>'
        +(cands?'<div class="cands"><b>후보지 · 웹 검색 결과</b>'+cands+'</div>':'')
        +'<div class="vote"><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div>'
        +'<div class="lb"><span>'+(auto?'<b>시간 지나 자동 확정 🌕</b>':done?'<b>전원 확정 🌕</b>':'확정 <b>'+votes+'</b> / '+total+'명')+'</span>'
        +'<span>'+(auto?'약속 시간이 지났어요':done?'약속이 잡혔어요':'모두 누르면 확정돼요')+'</span></div></div>'
        +'<button '+(done||mine?'disabled':'')+' onclick="confirmPlan('+i+')">'+(auto?'시간이 지나 확정됨':done?'약속 확정됨':mine?'확정했어요 ✓ · 다른 멤버 기다리는 중':'이 약속으로 확정')+'</button>'
        +'</div></div></div>';
    }
    const p=PEOPLE[m.f]||UNKNOWN;
    return '<div class="msg"><div class="mav">'+p.av+'</div><div><div class="who">'+label(m.f,r)+'</div><div class="bub">'+esc(m.x)+'</div></div></div>';
  }).join('');
  $('msgs').scrollTop=$('msgs').scrollHeight;
}
async function sendMsg(){
  const v=$('cin').value.trim(); if(!v||!CUR)return;
  const r=S.rooms[CUR];
  if(BACKEND){
    const body=v.slice(0,500); $('cin').value='';   // 메시지 500자 제한
    const {data,error}=await sb.from('messages').insert({meeting_id:CUR,sender_id:ME,body}).select('id,sender_id,body,created_at').single();
    if(error){netFail('메시지 전송');$('cin').value=body;return}
    if(pushMsg(r,data))renderMsgs();   // Realtime으로 같은 메시지가 와도 id로 한 번만 그린다
    return;
  }
  r.msgs.push({f:'me',x:v,t:nowT()});
  $('cin').value=''; renderMsgs();
  const m=MEETINGS.find(x=>x.id===CUR);
  const pid=m.members[Math.floor(Math.random()*m.members.length)];
  showTyping(PEOPLE[pid], r, ()=>{
    r.msgs.push({f:pid,x:REPLIES[Math.floor(Math.random()*REPLIES.length)],t:nowT()});
    if(CUR)renderMsgs();
  });
}
function showTyping(p,room,cb){
  $('typing').style.display='block';
  $('typing').textContent=(S.met[Object.keys(PEOPLE).find(k=>PEOPLE[k]===p)]||room.revealed?p.real:p.nick)+' 님이 입력 중…';
  setTimeout(()=>{$('typing').style.display='none';cb()},1100+Math.random()*900);
}

/* + 메뉴 */
function openPlus(){
  $('plusAlbum').disabled=!S.rooms[CUR].iAttended;
  $('plusRate').disabled=!S.rooms[CUR].iAttended;
  $('pluswrap').classList.add('on');
}
function hidePlus(){$('pluswrap').classList.remove('on')}
async function aiPlan(){
  hidePlus();
  const id=CUR, r=S.rooms[id];
  if(r.msgs.some(m=>m.f==='ai')){toast('AI 약속','이미 이 방에 추천 약속이 있어요');return}
  $('typing').style.display='block';$('typing').textContent='MoonLight AI가 대화를 읽고 있어요…';
  if(BACKEND){
    try{
      const d=await callFn('suggest-meeting-plan',{meeting_id:id});
      const pl=d.plan||{};
      applyPlan(r,{id:pl.id,place:pl.place,time_label:pl.time,meet_at:pl.meet_at||null,activity:pl.activity,nearby:pl.nearby||[],candidates:pl.candidates||[],confirmed:false,source:d.fallback?'fallback':'llm',created_at:new Date().toISOString()});
      if(d.fallback)toast('기본 제안','AI 응답이 지연되어 기본 약속안을 보여드려요');
      else if(d.search_used&&d.search_used!=='none')toast('후보지 검색','실제 장소 '+((pl.candidates||[]).length)+'곳을 웹에서 찾았어요');
      if(CUR===id){renderMsgs();renderBanner()}
    }catch(e){ if(e.code!=='UNAUTHORIZED')toast('AI 약속','약속 제안에 실패했어요 · 다시 시도해 주세요') }
    finally{$('typing').style.display='none'}
    return;
  }
  setTimeout(()=>{
    $('typing').style.display='none';
    r.msgs.push({f:'sys',x:'MoonLight AI가 지금까지의 대화를 바탕으로 약속을 제안했어요'});
    const base=PLANS[id]||{};
    const msg={f:'ai',plan:Object.assign({},base,{cands:PLAN_CANDS[id]||[],meetAt:new Date(Date.now()+(base.inH||0)*3600000).toISOString()}),planId:'local-'+id,t:nowT()};
    r.msgs.push(msg);
    checkPlanDone(id,msg);   // 이미 지난 약속이면 투표 없이 바로 확정된다
    if(CUR===id){renderMsgs();renderBanner()}
  },1600);
}
/* 확정 = 투표. 채팅방 인원 전원이 눌러야 약속이 잡힌다 */
async function confirmPlan(i){
  const id=CUR, r=S.rooms[id], msg=r.msgs[i]; if(!msg||!msg.planId)return;
  const set=r.votes[msg.planId]||(r.votes[msg.planId]=new Set());
  if(set.has(MYID()))return;
  if(BACKEND){
    const {error}=await sb.from('meeting_plan_votes').upsert({plan_id:msg.planId,meeting_id:id,user_id:ME},{onConflict:'plan_id,user_id',ignoreDuplicates:true});
    if(error){netFail('약속 확정');return}
    set.add(ME); checkPlanDone(id,msg); renderMsgs(); renderBanner();
    toast('확정 투표','채팅방 멤버 모두가 누르면 약속이 잡혀요');
    return;
  }
  set.add('me'); renderMsgs();
  toast('확정 투표','다른 멤버들의 확정을 기다려요');
  // 로컬 데모: 다른 멤버들이 차례로 확정하는 상황을 시뮬레이션
  const m=MEETINGS.find(x=>x.id===id);
  m.members.forEach((pid,k)=>setTimeout(()=>{
    const rr=S.rooms[id]; if(!rr)return;
    (rr.votes[msg.planId]||(rr.votes[msg.planId]=new Set())).add(pid);
    const done=checkPlanDone(id,msg);
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
    r.attended.add(MYID()); r.iAttended=true; r.revealed=true;
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
  $('pgrid').innerHTML=r.photos.map(p=>'<div class="photo" style="background:'+p.g+'">'+p.l+'</div>').join('')
    +'<button class="photo" style="background:var(--card);border:1.5px dashed var(--line);align-items:center;justify-content:center;color:var(--tx3)">＋ 사진 추가</button>';
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

