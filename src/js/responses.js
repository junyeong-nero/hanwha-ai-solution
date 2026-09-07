/* 의견 제출 링크와 방장 비교 화면. 공유 링크는 인증을 대신하지 않는다. */
let POLL=null, POLL_DRAFT=null, POLL_BUSY=false, POLL_ORIGIN=null, POLL_LOAD_ID=null, POLL_VERSION=0, POLL_CHANNEL=null, POLL_CHANNEL_ID=null, POLL_DASHBOARD=false;
function pollTime(value){return new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}
function pollSlots(start){
  const slots=[];
  for(let d=0;d<7;d++)for(let h=0;h<8;h++)slots.push(new Date(Date.parse(start+'T18:00:00+09:00')+d*86400000+h*1800000).toISOString());
  return slots;
}
function pollStats(q){
  const responses=q.responses.filter(r=>q.members.some(m=>m.id===r.user_id));
  return {counts:q.candidates.map((_,i)=>responses.filter(r=>r.candidate===i).length),
    times:q.slots.map(s=>responses.filter(r=>r.slots.some(t=>Date.parse(t)===Date.parse(s))).length),
    missing:q.members.filter(m=>!responses.some(r=>r.user_id===m.id)),responses};
}
function pollClosed(q){return q.confirmed||Date.parse(q.deadline)<=Date.now()}
function pollShell(title,html){
  $('pollview').hidden=false;
  $('pollview').innerHTML='<div class="top"><h2>'+esc(title)+'</h2><button class="ib" aria-label="의견 화면 닫기" onclick="closePoll()">'+ico('x')+'</button></div><div class="pollbody">'+html+'</div>';
}
function closePoll(){
  POLL_VERSION++;stopPollSync();$('pollview').hidden=true; POLL=null;POLL_DRAFT=null;
  const url=new URL(location.href);url.searchParams.delete('poll');history.replaceState(null,'',url);
}
function resetPoll(){POLL_VERSION++;stopPollSync();if($('pollview'))$('pollview').hidden=true;POLL=null;POLL_DRAFT=null;POLL_BUSY=false}
/* 공유 링크로 직접 들어온 경우에도 채팅방 구독과 독립적으로 확정을 받는다. */
function stopPollSync(){
  if(POLL_CHANNEL&&sb)sb.removeChannel(POLL_CHANNEL);
  POLL_CHANNEL=null;POLL_CHANNEL_ID=null;
}
function syncPollPlan(plan){
  const q=POLL;if(!q||plan?.id!==q.plan_id||!plan.confirmed||q.confirmed)return;
  q.confirmed=true;q.plan=plan;
  const r=S.rooms[q.meeting_id];
  if(r){applyPlan(r,plan);if(CUR===q.meeting_id){renderMsgs();renderBanner()}}
  if(POLL_DASHBOARD)renderPollDashboard();else renderPoll();
}
function startPollSync(q){
  if(!BACKEND||POLL_CHANNEL_ID===q.id)return;
  stopPollSync();POLL_CHANNEL_ID=q.id;
  POLL_CHANNEL=sb.channel('poll-'+q.id)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'meeting_plans',filter:'id=eq.'+q.plan_id},p=>syncPollPlan(p.new))
    .subscribe(async status=>{
      if(status!=='SUBSCRIBED')return;
      try{const fresh=await pollRpc('get_meeting_poll',{p_poll_id:q.id});if(POLL?.id===q.id)syncPollPlan(fresh.plan)}catch(e){if(POLL?.id===q.id)pollError(e)}
    });
}
/* 의견 수집이 일반 일정 저장보다 나중 단계이므로 시작 시 마지막에 복원한다. */
function restorePollRoom(q){
  if(!q?.meeting||q.meeting.id!==q.meeting_id||!q.plan?.id||!q.plan.collecting)return;
  ensureMeeting(q.meeting_id,q.meeting);
  if(!S.joined.includes(q.meeting_id))S.joined.push(q.meeting_id);
  applyPlan(ensureRoom(q.meeting_id),q.plan);
}
function restorePollRooms(){
  if(BACKEND)return;
  try{for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key.startsWith('moonlight-poll-'))continue;
    try{restorePollRoom(JSON.parse(localStorage.getItem(key)))}catch(e){}
  }}catch(e){}
}
async function pollRpc(name,args){const {data,error}=await sb.rpc(name,args);if(error)throw new Error(error.message);return data}
function pollError(e){toast('의견 조율',e.message||'연결을 확인하고 다시 시도해 주세요')}
async function openPollLink(){
  const id=new URLSearchParams(location.search).get('poll');
  if(id)await loadPoll(id);
}
async function loadPoll(id){
  const version=++POLL_VERSION;POLL_LOAD_ID=id;
  try{
    POLL=null;
    let q;
    if(BACKEND)q=await pollRpc('get_meeting_poll',{p_poll_id:id});
    else{q=JSON.parse(localStorage.getItem('moonlight-poll-'+id)||'null');if(!q)throw new Error('이 브라우저에 저장된 데모 링크가 아니에요');}
    if(version!==POLL_VERSION)return;
    if(!q)throw new Error('의견 링크를 찾을 수 없어요');
    POLL=q;POLL_DRAFT=null;startPollSync(q);
    if(!BACKEND){
      if(!S.joined.includes(q.meeting_id))S.joined.push(q.meeting_id);
      if(q.meeting)ensureMeeting(q.meeting_id,q.meeting);
      ensureRoom(q.meeting_id);
    }
    if(S.rooms[q.meeting_id]){applyPlan(S.rooms[q.meeting_id],q.plan);if(CUR===q.meeting_id){renderMsgs();renderBanner()}}
    renderPoll();
  }catch(e){if(version!==POLL_VERSION)return;pollShell('의견 링크 안내','<div class="empty"><i>'+ico('users')+'</i><b>의견 화면을 열 수 없어요</b><p>'+esc(e.message)+'</p><button class="cta" onclick="loadPoll(POLL_LOAD_ID)">다시 시도</button></div>')}
}
async function openRoomPoll(){
  hidePlus();
  const r=S.rooms[CUR], msg=r&&[...r.msgs].reverse().find(m=>m.f==='ai');
  if(!msg){toast('의견 조율','먼저 AI 추천 약속으로 장소 후보를 만들어 주세요');return}
  if(msg.plan.pollId){await loadPoll(msg.plan.pollId);return}
  if(r.planned){toast('의견 조율','이미 확정된 약속이에요');return}
  POLL_ORIGIN={meeting:CUR,msg};
  const tomorrow=new Date(Date.now()+2*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  pollShell('의견 수집 시작','<p>방장이 마감과 후보 날짜를 정하면 참여자에게 링크를 공유할 수 있어요.</p><p>후보 시간은 시작일부터 7일간, 매일 18:00~22:00의 30분 단위예요. 모든 시각은 한국 시간입니다.</p>'
    +'<label class="pollfield">제출 마감<input id="pollDeadline" type="datetime-local" value="'+tomorrow+'T12:00"></label>'
    +'<label class="pollfield">후보 시작일<input id="pollStart" type="date" value="'+tomorrow+'"></label>'
    +'<button class="cta" onclick="createPoll()">의견 수집 시작</button>');
}
async function createPoll(){
  if(POLL_BUSY)return;
  const version=POLL_VERSION;
  try{
    POLL_BUSY=true;
    const {meeting:id,msg}=POLL_ORIGIN, deadline=new Date($('pollDeadline').value+':00+09:00').toISOString(), slots=pollSlots($('pollStart').value);
    if(Date.parse(deadline)<=Date.now()||slots.some(s=>Date.parse(s)<=Date.parse(deadline)))throw new Error('마감은 현재 이후, 후보 시간은 마감 이후로 정해 주세요');
    let qid;
    if(BACKEND)qid=await pollRpc('create_meeting_poll',{p_plan_id:msg.planId,p_deadline:deadline,p_slots:slots});
    else{
      const m=MEETINGS.find(m=>m.id===id);
      if(!m.mine)throw new Error('방장만 시작할 수 있어요. 직접 만든 모임에서 이용해 주세요');
      if(!msg.plan.cands?.length)throw new Error('장소 후보가 필요해요');
      qid=crypto.randomUUID();
      const q={id:qid,meeting_id:id,plan_id:msg.planId,title:m.name,activity:msg.plan.act,meeting:m,deadline,slots,candidates:msg.plan.cands,host:true,confirmed:false,
        members:[{id:MYID(),name:S.profile.nick},...m.members.map(id=>({id,name:PEOPLE[id]?.nick||'익명'}))],responses:[],
        plan:{id:msg.planId,place:msg.plan.place,time_label:msg.plan.when,meet_at:msg.plan.meetAt,activity:msg.plan.act,nearby:[msg.plan.food].filter(Boolean),candidates:msg.plan.cands,selected_place:msg.plan.selected,schedule:msg.plan.schedule,schedule_host:msg.plan.scheduleHost,collecting:true,poll_id:qid}};
      localStorage.setItem('moonlight-poll-'+qid,JSON.stringify(q));
    }
    if(version!==POLL_VERSION)return;
    msg.plan.collecting=true;msg.plan.pollId=qid;
    if(CUR===id)renderMsgs();
    await loadPoll(qid);
  }catch(e){pollError(e)}finally{POLL_BUSY=false}
}
function renderPoll(review=false){
  const q=POLL;if(!q)return;POLL_DASHBOARD=false;
  const mine=q.responses.find(r=>r.user_id===MYID());
  if(!POLL_DRAFT)POLL_DRAFT={candidate:mine?.candidate??null,slots:[...(mine?.slots||[])],comment:mine?.comment||''};
  const d=POLL_DRAFT, closed=pollClosed(q);
  const top='<p>'+esc(q.title)+' · '+esc(q.activity||'')+'</p><p>제출 마감 '+esc(pollTime(q.deadline))+' (한국 시간)</p>'
    +'<p role="status">'+(q.confirmed?'약속이 확정되었어요':closed?'제출 마감 · 기존 응답을 확인할 수 있어요':mine?'제출 완료 · 마감 전까지 수정할 수 있어요':'장소와 가능한 시간, 의견을 함께 보내 주세요')+'</p>'
    +pollResult(q)
    +(!BACKEND?'<p>로컬 데모: 이 브라우저에만 의견이 저장됩니다.</p>':'');
  if(review){
    pollShell('제출 전 확인',top+'<div class="card"><b>'+esc(q.candidates[d.candidate].name)+'</b><p>'+(d.slots.map(pollTime).map(esc).join(' · ')||'가능한 시간 없음')+'</p><p>'+esc(d.comment||'기타 의견 없음')+'</p></div>'
      +'<button class="cta line" onclick="renderPoll()">수정하기</button><button class="cta" onclick="submitPoll()">이 내용으로 제출</button>');return;
  }
  const candidates=q.candidates.map((c,i)=>'<label class="pollchoice"><input type="radio" name="pollCandidate" value="'+i+'" '+(d.candidate===i?'checked ':'')+(closed?'disabled ':'')+'onchange="POLL_DRAFT.candidate='+i+'"><span><b>'+esc(c.name)+'</b><small>'+esc(c.address||c.addr||'')+'</small></span></label>').join('');
  const days=[];
  q.slots.forEach((s,i)=>{if(i%8===0)days.push([]);days[days.length-1].push(s)});
  const grid=days.map(day=>'<fieldset><legend>'+esc(pollTime(day[0]).split(' ').slice(0,2).join(' '))+'</legend>'+day.map(s=>{
    const on=d.slots.some(t=>Date.parse(t)===Date.parse(s)), index=q.slots.indexOf(s);
    return '<label class="pollslot"><input type="checkbox" '+(on?'checked ':'')+(closed?'disabled ':'')+'onchange="togglePollSlot('+index+',this.checked)"><span>'+esc(pollTime(s).split(' ').at(-1))+'</span></label>';
  }).join('')+'</fieldset>').join('');
  pollShell('모임 의견 제출',top+'<fieldset class="pollcandidates" '+(closed?'disabled':'')+'><legend>장소·활동 후보 · 한 곳 선택</legend>'+candidates+'</fieldset>'
    +'<h3>가능한 시간</h3><p>한 칸은 30분이에요. 가능한 칸을 모두 선택하세요. 선택하지 않으면 가능한 시간 없음으로 제출됩니다.</p><div class="pollgrid">'+grid+'</div>'
    +'<label class="pollfield">기타 의견<textarea aria-label="기타 의견" maxlength="1000" '+(closed?'disabled':'')+' oninput="POLL_DRAFT.comment=this.value">'+esc(d.comment)+'</textarea></label>'
    +(!closed?'<button class="cta" onclick="reviewPoll()">제출 전 요약 보기</button>':'')
    +(q.host?'<button class="cta line" onclick="renderPollDashboard()">방장 · 응답 비교 및 확정</button>':''));
}
function togglePollSlot(i,on){const s=POLL.slots[i];POLL_DRAFT.slots=POLL_DRAFT.slots.filter(t=>Date.parse(t)!==Date.parse(s));if(on)POLL_DRAFT.slots.push(s)}
function reviewPoll(){if(POLL_DRAFT.candidate===null){toast('장소 선택','선호하는 후보를 한 곳 골라 주세요');return}renderPoll(true)}
async function submitPoll(){
  if(POLL_BUSY)return;
  const version=POLL_VERSION;
  try{
    POLL_BUSY=true;const q=POLL,d=POLL_DRAFT;
    if(pollClosed(q))throw new Error('의견 제출이 마감되었어요');
    if(BACKEND)await pollRpc('submit_meeting_response',{p_poll_id:q.id,p_candidate:d.candidate,p_slots:d.slots,p_comment:d.comment});
    else{q.responses=q.responses.filter(r=>r.user_id!==MYID());q.responses.push({...d,user_id:MYID()});localStorage.setItem('moonlight-poll-'+q.id,JSON.stringify(q))}
    if(version!==POLL_VERSION)return;
    await loadPoll(q.id);toast('제출 완료','의견이 저장되었어요');
  }catch(e){pollError(e)}finally{POLL_BUSY=false}
}
function pollResult(q){return q.confirmed?'<div class="card"><b>최종 약속 · '+esc(q.plan.place)+'</b><p>'+esc(q.plan.time_label)+'</p><button class="cta" onclick="openPollRoom()">채팅방에서 약속 보기</button></div>':''}
function openPollRoom(){const id=POLL?.meeting_id;if(!id)return;closePoll();openJoined(id)}
function renderPollDashboard(){
  const q=POLL;if(!q?.host)return;POLL_DASHBOARD=true;
  const stats=pollStats(q), n=q.members.length;
  pollShell('응답 비교 · 최종 확정','<p>'+esc(q.title)+' · 마감 '+esc(pollTime(q.deadline))+'</p><p>응답 완료 '+stats.responses.length+'/'+n+'명</p>'+pollResult(q)
    +'<p>응답 완료: '+esc(q.members.filter(m=>stats.responses.some(r=>r.user_id===m.id)).map(m=>m.name).join(', ')||'없음')+'</p>'
    +'<p>미응답: '+esc(stats.missing.map(m=>m.name).join(', ')||'없음')+'</p><button class="cta line" onclick="sharePoll()">제출 링크 복사 · 재공유</button><label class="pollfield">제출 링크<input id="pollShareLink" readonly value="'+esc(pollUrl())+'"></label>'
    +'<button class="cta line" onclick="refreshPollDashboard()">최신 응답 새로 보기</button>'
    +'<fieldset '+(q.confirmed?'disabled':'')+'><legend>장소 선택 · 후보별 득표</legend>'+q.candidates.map((c,i)=>'<label class="pollchoice"><input type="radio" name="finalCandidate" value="'+i+'"><span>'+esc(c.name)+' · '+stats.counts[i]+'표</span></label>').join('')+'</fieldset>'
    +'<label class="pollfield">시간 선택 · 전체 참여자 교집합<select id="pollFinalSlot" '+(q.confirmed?'disabled':'')+'><option value="">시간을 선택하세요</option>'+q.slots.map((s,i)=>'<option value="'+i+'" '+(Date.parse(s)<=Date.now()?'disabled':'')+'>'+esc(pollTime(s))+' · '+stats.times[i]+'/'+n+'명'+(n>0&&stats.times[i]===n?' · 전원 가능':'')+'</option>').join('')+'</select></label>'
    +'<p>미응답자는 가능 인원에 포함하지 않아요. 전원 가능은 전체 참여자가 같은 30분 칸을 선택한 경우예요.</p>'
    +'<h3>기타 의견 · '+stats.responses.filter(r=>r.comment).length+'건</h3>'+stats.responses.filter(r=>r.comment).map(r=>'<div class="card"><b>'+esc(q.members.find(m=>m.id===r.user_id)?.name||'익명')+'</b><p>'+esc(r.comment)+'</p></div>').join('')
    +'<button class="cta" '+(q.confirmed?'disabled':'')+' onclick="finalizePoll()">'+(q.confirmed?'이미 확정된 약속':'선택한 장소와 시간으로 최종 확정')+'</button><button class="cta line" onclick="renderPoll()">내 응답 확인</button>');
}
function pollUrl(){const url=new URL(location.href);url.searchParams.set('poll',POLL.id);if(!BACKEND)url.searchParams.set('demo','1');return url.href}
async function sharePoll(){try{await navigator.clipboard.writeText(pollUrl());toast('링크 복사','모임 참여자에게 공유해 주세요')}catch(e){$('pollShareLink').select();toast('제출 링크','링크를 선택했어요. 길게 눌러 복사해 주세요')}}
async function refreshPollDashboard(){const id=POLL.id;await loadPoll(id);if(POLL?.id===id)renderPollDashboard()}
async function finalizePoll(){
  if(POLL_BUSY)return;
  const version=POLL_VERSION;
  try{
    const q=POLL, selected=document.querySelector('input[name="finalCandidate"]:checked'), value=$('pollFinalSlot').value;
    if(!selected||value==='')throw new Error('장소와 시간을 모두 선택해 주세요');
    if(q.confirmed)throw new Error('이미 확정된 약속이에요');
    const candidate=Number(selected.value),slot=q.slots[Number(value)];POLL_BUSY=true;
    let plan;
    if(BACKEND)plan=await pollRpc('finalize_meeting_poll',{p_poll_id:q.id,p_candidate:candidate,p_slot:slot});
    else{
      if(Date.parse(slot)<=Date.now())throw new Error('미래의 후보 시간을 선택해 주세요');
      q.confirmed=true;q.plan={...q.plan,place:q.candidates[candidate].name,selected_place:q.candidates[candidate],meet_at:slot,time_label:pollTime(slot)+' (한국 시간)',confirmed:true,confirm_reason:'host'};
      localStorage.setItem('moonlight-poll-'+q.id,JSON.stringify(q));plan=q.plan;
    }
    if(version!==POLL_VERSION)return;
    if(S.rooms[q.meeting_id]){applyPlan(S.rooms[q.meeting_id],plan);if(CUR===q.meeting_id){renderMsgs();renderBanner()}}
    await loadPoll(q.id);renderPollDashboard();toast('약속 확정','채팅방에 장소와 시간을 공유했어요');
  }catch(e){pollError(e)}finally{POLL_BUSY=false}
}
