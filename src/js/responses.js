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
  const r=S.rooms[CUR],msg=r&&[...r.msgs].reverse().find(m=>m.f==='ai');
  if(!r)return;
  if(msg?.plan.pollId){await loadPoll(msg.plan.pollId);return}
  if(r.planned){toast('약속 잡기','이미 확정된 약속이에요');return}
  POLL_VERSION++;POLL=null;POLL_DRAFT=null;stopPollSync();
  POLL_ORIGIN={meeting:CUR,msg:null};
  const day=n=>new Date(Date.now()+n*86400000+9*3600000).toISOString().slice(0,10);
  pollShell('약속 잡기','<p>1. 날짜 범위 정하기 → 2. 가능한 시간과 장소 선택 → 3. 방장 확정</p><p>AI가 최근 대화의 음식·활동·지역 선호로 장소를 추천해요. 모임 주제와 다른 만남도 괜찮아요.</p>'
    +'<div class="av-config"><label>시작 날짜<input id="pollStart" type="date" value="'+day(2)+'"></label>'
    +'<label>종료 날짜<input id="pollEnd" type="date" value="'+day(8)+'"></label>'
    +'<label>시작 시간<input id="pollFrom" type="time" step="1800" value="18:00"></label>'
    +'<label>종료 시간<input id="pollTo" type="time" step="1800" value="22:00"></label></div>'
    +'<details><summary>응답 마감 설정</summary><label class="pollfield">제출 마감<input id="pollDeadline" type="datetime-local" value="'+day(1)+'T22:00"></label></details>'
    +'<p>한국 시간 · 최대 7일 · 한 칸 30분. 방장이 범위를 정하면 멤버들이 같은 표에 응답해요. 최근 대화 일부가 익명 처리되어 외부 AI에 전송돼요.</p>'
    +'<button id="pollCreate" class="cta" onclick="createPoll()">장소 추천받고 시간표 열기</button><p id="pollCreateStatus" role="status" aria-live="polite"></p>');
}
async function createPoll(){
  if(POLL_BUSY)return;
  const version=POLL_VERSION;
  try{
    POLL_BUSY=true;
    const origin=POLL_ORIGIN, id=origin.meeting;
    const minutes=id=>{const [h,m]=$(id).value.split(':').map(Number);return h*60+m};
    const deadline=new Date($('pollDeadline').value+':00+09:00').toISOString();
    const slots=availabilitySlots({start:$('pollStart').value,end:$('pollEnd').value,from:minutes('pollFrom'),to:minutes('pollTo')});
    if(Date.parse(deadline)<=Date.now()||slots.some(s=>Date.parse(s)<=Date.parse(deadline)))throw new Error('마감은 현재 이후, 후보 시간은 마감 이후로 정해 주세요');
    if(Date.parse(deadline)>Date.now()+30*86400000||slots.some(s=>Date.parse(s)>Date.now()+60*86400000))throw new Error('마감은 30일 이내, 후보 날짜는 60일 이내로 정해 주세요');
    $('pollCreate').disabled=true;$('pollCreateStatus').textContent='대화를 읽고 실제 장소 후보를 찾고 있어요…';
    const msg=origin.msg||await recommendPollPlaces(id);
    origin.msg=msg;
    if(version!==POLL_VERSION)return;
    let qid;
    if(BACKEND)qid=await pollRpc('create_meeting_poll',{p_plan_id:msg.planId,p_deadline:deadline,p_slots:slots});
    else{
      const m=MEETINGS.find(m=>m.id===id);
      // 로컬 데모에서는 사용자가 방장 역할을 맡는다.
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
  }catch(e){pollError(e);if(version===POLL_VERSION)$('pollCreateStatus').textContent=e.message||'잠시 후 다시 시도해 주세요'}finally{POLL_BUSY=false;if(version===POLL_VERSION)$('pollCreate').disabled=false}
}
function renderPoll(){
  const q=POLL;if(!q)return;POLL_DASHBOARD=false;
  const mine=q.responses.find(r=>r.user_id===MYID());
  if(!POLL_DRAFT)POLL_DRAFT={candidate:mine?.candidate??null,slots:[...(mine?.slots||[])],comment:mine?.comment||''};
  const d=POLL_DRAFT, closed=pollClosed(q);
  const top='<p>'+esc(q.title)+' · '+esc(q.activity||'')+'</p><p>제출 마감 '+esc(pollTime(q.deadline))+' (한국 시간)</p>'
    +'<p role="status">'+(q.confirmed?'약속이 확정되었어요':closed?'제출 마감 · 기존 응답을 확인할 수 있어요':mine?'제출 완료 · 마감 전까지 수정할 수 있어요':'장소와 가능한 시간, 의견을 함께 보내 주세요')+'</p>'
    +pollResult(q)
    +(!BACKEND?'<p>로컬 데모: 이 브라우저에만 의견이 저장됩니다.</p>':'');
  const candidates=q.candidates.map((c,i)=>'<label class="pollchoice"><input type="radio" name="pollCandidate" value="'+i+'" '+(d.candidate===i?'checked ':'')+(closed?'disabled ':'')+'onchange="POLL_DRAFT.candidate='+i+'"><span><b>'+esc(c.name)+'</b><small>'+esc(c.address||c.addr||'')+'</small><small>'+esc(c.why||'')+'</small></span></label>').join('');
  pollShell('시간과 장소 선택',top
    +'<h3>1. 가능한 시간 칠하기</h3><p>가로는 날짜, 세로는 시간이에요. 누른 채 움직여 여러 칸을 선택하거나 지우세요. 표 밖에서 스크롤하고, 키보드는 Tab·Space를 사용하세요.</p>'
    +pollGridHtml(q,false,closed)+'<p id="pollSelectionStatus" role="status" aria-live="polite">'+d.slots.length+'칸 선택 · 한 칸 30분</p>'
    +'<fieldset class="pollcandidates" '+(closed?'disabled':'')+'><legend>2. 만나고 싶은 장소 · 한 곳 선택</legend>'+candidates+'</fieldset>'
    +'<details><summary>기타 의견 남기기</summary><label class="pollfield">기타 의견<textarea aria-label="기타 의견" maxlength="1000" '+(closed?'disabled':'')+' oninput="POLL_DRAFT.comment=this.value">'+esc(d.comment)+'</textarea></label></details>'
    +(!closed?'<button class="cta" onclick="savePollResponse()">가능 시간과 장소 저장</button>':'')
    +(q.host?'<button class="cta line" onclick="renderPollDashboard()">응답 비교 · 약속 확정</button>':''));
  bindPollGrid(false);
}
/* 날짜와 시간 축을 분리한다. 슬롯 순서나 하루의 칸 수에 의존하지 않는다. */
function pollAxes(slots){
  const keys=slots.map(s=>{const k=new Date(Date.parse(s)+9*3600000).toISOString();return {day:k.slice(0,10),time:k.slice(11,16)}});
  return {keys,days:[...new Set(keys.map(k=>k.day))].sort(),times:[...new Set(keys.map(k=>k.time))].sort()};
}
function pollRectangle(slots,start,end){
  const a=pollAxes(slots),p=a.keys[start],q=a.keys[end];if(!p||!q)return [];
  const loDay=p.day<q.day?p.day:q.day,hiDay=p.day>q.day?p.day:q.day;
  const loTime=p.time<q.time?p.time:q.time,hiTime=p.time>q.time?p.time:q.time;
  return a.keys.flatMap((k,i)=>k.day>=loDay&&k.day<=hiDay&&k.time>=loTime&&k.time<=hiTime?[i]:[]);
}
function pollGridHtml(q,summary=false,closed=false){
  const a=pollAxes(q.slots),stats=summary?pollStats(q):null,n=q.members?.length||0;
  const selected=new Set((POLL_DRAFT?.slots||[]).map(Date.parse));
  const headers=a.days.map(day=>'<th scope="col">'+esc(day.slice(5).replace('-','/'))+'<small>'+new Date(day+'T00:00:00+09:00').toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',weekday:'short'})+'</small></th>').join('');
  return '<div class="pollgrid-scroll" tabindex="0" aria-label="시간표 가로 스크롤"><table class="pollgrid" id="pollTimeGrid"><caption>'+ (summary?'참여자 가능 시간 비교':'내 가능 시간 · 한국 시간')+'</caption><thead><tr><th scope="col">시간</th>'+headers+'</tr></thead><tbody>'
    +a.times.map(time=>'<tr><th scope="row">'+time+'</th>'+a.days.map(day=>{
      const i=a.keys.findIndex(k=>k.day===day&&k.time===time);if(i<0)return '<td></td>';
      const count=stats?.times[i]||0,on=summary?false:selected.has(Date.parse(q.slots[i]));
      return '<td><button type="button" class="pollcell '+(summary?(count===n&&n?'all':count?'some':''):'')+'" data-slot="'+i+'" aria-label="'+esc(pollTime(q.slots[i]))+(summary?' · '+count+'/'+n+'명 가능':'')+'" aria-pressed="'+on+'" '+(closed||(summary&&Date.parse(q.slots[i])<=Date.now())?'disabled':'')+'>'+(summary?count+'/'+n:on?'✓':'')+'</button></td>';
    }).join('')+'</tr>').join('')+'</tbody></table></div>';
}
function bindPollGrid(summary){
  const grid=$('pollTimeGrid');let drag=null;
  const paint=end=>{
    const indices=pollRectangle(POLL.slots,drag.start,end),next=new Set(drag.original);
    indices.forEach(i=>drag.add?next.add(Date.parse(POLL.slots[i])):next.delete(Date.parse(POLL.slots[i])));
    POLL_DRAFT.slots=POLL.slots.filter(s=>next.has(Date.parse(s)));
    grid.querySelectorAll('[data-slot]').forEach(b=>{const on=next.has(Date.parse(POLL.slots[+b.dataset.slot]));b.setAttribute('aria-pressed',String(on));b.textContent=on?'✓':''});
    $('pollSelectionStatus').textContent=POLL_DRAFT.slots.length+'칸 선택 · 저장하면 반영돼요';
  };
  grid.onpointerdown=e=>{const b=e.target.closest('[data-slot]');if(summary||!b||b.disabled||e.button!==0||pollClosed(POLL))return;e.preventDefault();grid.setPointerCapture(e.pointerId);const original=new Set(POLL_DRAFT.slots.map(Date.parse));drag={start:+b.dataset.slot,original,add:!original.has(Date.parse(POLL.slots[+b.dataset.slot]))};paint(drag.start)};
  grid.onpointermove=e=>{if(!drag)return;const b=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot]');if(b&&grid.contains(b))paint(+b.dataset.slot)};
  grid.onpointerup=grid.onpointercancel=grid.onlostpointercapture=()=>{drag=null};
  grid.onclick=e=>{const b=e.target.closest('[data-slot]');if(!b||b.disabled)return;
    if(summary){$('pollFinalSlot').value=b.dataset.slot;grid.querySelectorAll('[data-slot]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));return}
    if(e.detail!==0||pollClosed(POLL))return;togglePollSlot(+b.dataset.slot,b.getAttribute('aria-pressed')!=='true');b.setAttribute('aria-pressed',String(POLL_DRAFT.slots.some(s=>Date.parse(s)===Date.parse(POLL.slots[+b.dataset.slot]))));b.textContent=b.getAttribute('aria-pressed')==='true'?'✓':'';$('pollSelectionStatus').textContent=POLL_DRAFT.slots.length+'칸 선택 · 저장하면 반영돼요';
  };
}
async function savePollResponse(){
  if(POLL_DRAFT.candidate===null){toast('장소 선택','선호하는 후보를 한 곳 골라 주세요');return}
  if(!POLL_DRAFT.slots.length&&!await askConfirm('가능한 시간이 없나요?','가능한 시간 없음으로 저장됩니다.','저장'))return;
  await submitPoll();
}

function togglePollSlot(i,on){const s=POLL.slots[i];POLL_DRAFT.slots=POLL_DRAFT.slots.filter(t=>Date.parse(t)!==Date.parse(s));if(on)POLL_DRAFT.slots.push(s)}

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
    +'<h3>시간별 가능 인원</h3><p>칸을 누르면 최종 후보 시간이 선택돼요. 전원 가능한 칸은 초록으로 표시해요.</p>'+pollGridHtml(q,true,q.confirmed)
    +'<label class="pollfield">시간 선택 · 전체 참여자 교집합<select id="pollFinalSlot" '+(q.confirmed?'disabled':'')+'><option value="">시간을 선택하세요</option>'+q.slots.map((s,i)=>'<option value="'+i+'" '+(Date.parse(s)<=Date.now()?'disabled':'')+'>'+esc(pollTime(s))+' · '+stats.times[i]+'/'+n+'명'+(n>0&&stats.times[i]===n?' · 전원 가능':'')+'</option>').join('')+'</select></label>'
    +'<p>미응답자는 가능 인원에 포함하지 않아요. 전원 가능은 전체 참여자가 같은 30분 칸을 선택한 경우예요.</p>'
    +'<h3>기타 의견 · '+stats.responses.filter(r=>r.comment).length+'건</h3>'+stats.responses.filter(r=>r.comment).map(r=>'<div class="card"><b>'+esc(q.members.find(m=>m.id===r.user_id)?.name||'익명')+'</b><p>'+esc(r.comment)+'</p></div>').join('')
    +'<button class="cta" '+(q.confirmed?'disabled':'')+' onclick="finalizePoll()">'+(q.confirmed?'이미 확정된 약속':'선택한 장소와 시간으로 최종 확정')+'</button><button class="cta line" onclick="renderPoll()">내 응답 확인</button>');
  bindPollGrid(true);
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
