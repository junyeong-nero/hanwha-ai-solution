/* 한국 시간의 30분 슬롯. UI와 저장소에 의존하지 않는 계산 함수 */
function availabilitySlots(c){
  const start=Date.parse(c.start+'T00:00:00+09:00'), end=Date.parse(c.end+'T00:00:00+09:00');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(c.start)||!/^\d{4}-\d{2}-\d{2}$/.test(c.end)||!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>6*86400000||new Date(start+9*3600000).toISOString().slice(0,10)!==c.start||new Date(end+9*3600000).toISOString().slice(0,10)!==c.end||!Number.isInteger(c.from)||!Number.isInteger(c.to)||c.from<0||c.to>1440||c.from>=c.to||c.from%30||c.to%30)throw Error('날짜는 최대 7일, 시간은 30분 단위로 설정해 주세요');
  const slots=[];
  for(let d=start;d<=end;d+=86400000)for(let t=c.from;t<c.to;t+=30)slots.push(new Date(d+t*60000).toISOString());
  return slots;
}
function availabilitySummary(slots,members,responses){
  const ids=[...new Set(members)], sets=ids.map(id=>new Set(responses[id]||[]));
  const counts=slots.map(slot=>sets.filter(s=>s.has(slot)).length), max=Math.max(0,...counts);
  return slots.map((slot,i)=>({slot,count:counts[i],total:ids.length,all:ids.length>0&&counts[i]===ids.length,best:max>0&&counts[i]===max}));
}
function availabilityLabel(slot){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(slot))}
let AV=null;
function availabilityMembers(){return [MYID(),...MEETINGS.find(m=>m.id===AV.room).members]}
function availabilityLocked(msg,r){return msg.plan.collecting||r.plannedId===msg.planId||planDue(msg.plan)||(r.votes[msg.planId]||new Set()).size>0}
function closeAvailability(){const active=AV;AV=null;$('availabilitywrap').classList.remove('on');if(active)document.querySelector('[onclick="openAvailability(\''+active.planId+'\')"]')?.focus()}
async function openAvailability(planId){
  const room=CUR,r=S.rooms[room],msg=r.msgs.find(m=>m.planId===planId);if(!msg)return;
  if(BACKEND)await refreshMembers(room);
  AV={room,planId,msg,draft:new Set(msg.plan.schedule?.responses?.[MYID()]||[]),dirty:false,revision:msg.plan.schedule?.revision||0,view:MYID()};
  $('availabilitywrap').classList.add('on');renderAvailability();$('availabilitywrap').querySelector('[aria-label="닫기"]').focus();
  $('availabilitywrap').onkeydown=e=>{if(e.key==='Escape')closeAvailability();if(e.key==='Tab'){const controls=[...$('availabilitywrap').querySelectorAll('button:not(:disabled),input,select,summary')].filter(el=>el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
}
function renderAvailability(){
  if(!AV)return;
  const {msg}=AV,c=msg.plan.schedule,locked=availabilityLocked(msg,S.rooms[AV.room]);
  const host=BACKEND?msg.plan.scheduleHost===MYID():true;
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  $('availabilitybody').innerHTML='<p>한국 시간 · 30분 단위 · 최대 7일. 표 밖에서 스크롤하고, 표 안에서 가능한 시간을 칠하세요. Tab과 Space로도 선택할 수 있어요.</p>'
    +(locked?'<p role="status">의견 수집 또는 확정이 시작되어 일정 입력이 잠겼어요.</p>':'')
    +(host&&!locked?'<details'+(!c?' open':'')+'><summary>조율 범위 설정'+(c?' · 변경하면 응답 초기화':'')+'</summary><div class="av-config"><label>시작 날짜<input id="avstart" type="date" value="'+(c?.start||today)+'"></label><label>종료 날짜<input id="avend" type="date" value="'+(c?.end||today)+'"></label><label>시작 시간<input id="avfrom" type="time" step="1800" value="'+avTime(c?.from??1080)+'"></label><label>종료 시간<input id="avto" type="time" step="1800" value="'+avTime(c?.to??1260)+'"></label></div><button class="cta line" onclick="configureAvailability()">범위 적용 · 응답 초기화</button></details>':'')
    +(!c?'<p>방장이 조율 범위를 설정하면 입력할 수 있어요.</p>':'<label>참여자별 보기<select id="avperson" onchange="AV.view=this.value;renderAvailabilityGrid()">'+availabilityMembers().map(id=>'<option value="'+esc(id)+'"'+(id===AV.view?' selected':'')+'>'+esc(id===MYID()?'나':(PEOPLE[id]?.nick||'익명'))+(Object.hasOwn(c.responses,id)?' · 응답':' · 미응답')+'</option>').join('')+'</select></label><p class="av-legend">전원 가능: 초록 · 최다 가능: 주황 · 일부 가능: 채움<br>테두리 ✓: 선택한 참여자의 가능 시간</p><div id="avgrid" class="av-grid"></div><button id="avsave" class="cta" onclick="saveAvailability()" '+(locked?'disabled':'')+'>내 가능 시간 저장</button><div id="avstatus" role="status" aria-live="polite"></div><div id="avcandidates"></div>');
  if(c)renderAvailabilityGrid();
}
function avTime(t){return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')}
function renderAvailabilityGrid(){
  const c=AV.msg.plan.schedule,slots=availabilitySlots(c),members=availabilityMembers();
  const rows=availabilitySummary(slots,members,c.responses), chosen=AV.view===MYID()?AV.draft:new Set(c.responses[AV.view]||[]);
  const locked=availabilityLocked(AV.msg,S.rooms[AV.room]), host=BACKEND?AV.msg.plan.scheduleHost===MYID():true;
  const perDay=(c.to-c.from)/30,days=slots.length/perDay;
  const ordered=Array.from({length:perDay},(_,t)=>Array.from({length:days},(_,d)=>d*perDay+t)).flat();
  $('avgrid').style.gridTemplateColumns='repeat('+days+',minmax(44px,1fr))';
  $('avgrid').innerHTML=ordered.map(i=>{const r=rows[i];return '<button type="button" data-slot="'+i+'" class="av-slot '+(r.all?'all':r.best?'best':r.count?'some':'')+'" aria-pressed="'+chosen.has(r.slot)+'" aria-label="'+availabilityLabel(r.slot)+'、'+r.count+'/'+r.total+'명 가능" '+(locked||AV.view!==MYID()?'disabled':'')+'><span>'+availabilityLabel(r.slot)+'</span><b>'+r.count+'/'+r.total+(chosen.has(r.slot)?' ✓':'')+'</b></button>'}).join('');
  const grid=$('avgrid');let drag=null;
  const paint=i=>{if(drag.seen.has(i))return;drag.seen.add(i);const slot=slots[i];drag.add?AV.draft.add(slot):AV.draft.delete(slot);AV.dirty=true;const b=grid.querySelector('[data-slot="'+i+'"]');b.setAttribute('aria-pressed',String(drag.add));b.querySelector('b').textContent=rows[i].count+'/'+rows[i].total+(drag.add?' ✓':'');$('avstatus').textContent='변경 사항을 저장해 주세요'};
  grid.onpointerdown=e=>{const b=e.target.closest('[data-slot]');if(!b||b.disabled||e.button!==0)return;e.preventDefault();grid.setPointerCapture(e.pointerId);drag={add:!AV.draft.has(slots[+b.dataset.slot]),seen:new Set()};paint(+b.dataset.slot)};
  grid.onpointermove=e=>{if(!drag)return;const b=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot]');if(b&&grid.contains(b))paint(+b.dataset.slot)};
  grid.onpointerup=grid.onpointercancel=grid.onlostpointercapture=()=>{drag=null};
  grid.onclick=e=>{if(e.detail!==0)return;const b=e.target.closest('[data-slot]');if(!b||b.disabled)return;drag={add:!AV.draft.has(slots[+b.dataset.slot]),seen:new Set()};paint(+b.dataset.slot);drag=null};
  $('avcandidates').innerHTML='<h4>최다 가능 후보 · 저장된 응답 기준</h4>'+(rows.some(r=>r.best)?rows.filter(r=>r.best).map(r=>'<button class="cta line" '+(!host||locked?'disabled':'')+' onclick="selectAvailability(\''+r.slot+'\')">'+availabilityLabel(r.slot)+' · '+r.count+'/'+r.total+'명'+(c.selected===r.slot?' · 선택됨':'')+'</button>').join(''):'<p>아직 가능한 시간이 없어요.</p>')+(!host?'<p>방장이 후보 중 하나를 고를 수 있어요.</p>':'');
}
async function availabilityWrite(action,payload){
  const av=AV;if(!av||av.busy)return false;av.busy=true;
  try{
    if(BACKEND){const {data,error}=await sb.rpc('update_plan_schedule',{p_plan_id:av.planId,p_action:action,p_payload:{...payload,revision:av.revision}});if(error)throw error;applyPlan(S.rooms[av.room],data);av.msg=S.rooms[av.room].msgs.find(m=>m.planId===av.planId)}
    else{
      if(availabilityLocked(av.msg,S.rooms[av.room]))throw Error('이미 확정 투표가 시작됐어요');
      if(action==='configure')av.msg.plan.schedule={...payload,responses:{},selected:null};
      if(action==='save'){av.msg.plan.schedule.responses[MYID()]=payload.slots;av.msg.plan.schedule.selected=null}
      if(action==='select'){if(Date.parse(payload.slot)<=Date.now())throw Error('미래 시간을 선택해 주세요');av.msg.plan.schedule.selected=payload.slot}
      const selected=av.msg.plan.schedule.selected;av.msg.plan.meetAt=selected;av.msg.plan.when=selected?availabilityLabel(selected)+' (한국 시간)':'시간 조율 중';
      persistAvailability(av.room);
    }
    av.dirty=false;av.revision=av.msg.plan.schedule.revision||0;av.draft=new Set(av.msg.plan.schedule.responses[MYID()]||[]);
    if(AV===av)renderAvailability();if(CUR===av.room){renderMsgs();renderBanner()}return true;
  }catch(e){toast('일정 저장 실패',esc(e.message||'다시 시도해 주세요'));return false}finally{av.busy=false}
}
async function configureAvailability(){
  const minutes=id=>{const [h,m]=$(id).value.split(':').map(Number);return h*60+m};
  const c={start:$('avstart').value,end:$('avend').value,from:minutes('avfrom'),to:minutes('avto')};
  try{availabilitySlots(c);await availabilityWrite('configure',c)}catch(e){toast('범위 확인',esc(e.message))}
}
async function saveAvailability(){await availabilityWrite('save',{slots:[...AV.draft]})}
async function selectAvailability(slot){if(AV.dirty){toast('가능 시간 저장','먼저 변경 사항을 저장해 주세요');return}if(await availabilityWrite('select',{slot}))toast('시간 선택 완료','약속 카드에서 장소를 고른 뒤 전원 확정해 주세요')}
function persistAvailability(id){
  if(BACKEND)return;const r=S.rooms[id],msg=r?.msgs.find(m=>m.plan?.schedule);if(!msg)return;
  localStorage.setItem('moonlight-availability-'+id,JSON.stringify({msg,meeting:MEETINGS.find(m=>m.id===id),votes:[...(r.votes[msg.planId]||[])],confirmed:r.plannedId===msg.planId}));
}
function restoreAvailability(id){
  if(BACKEND)return;
  try{const saved=JSON.parse(localStorage.getItem('moonlight-availability-'+id)),msg=saved?.msg;if(!msg?.plan?.schedule)return;availabilitySlots(msg.plan.schedule);const r=S.rooms[id];if(!r.msgs.some(m=>m.planId===msg.planId)){r.msgs.push(msg);r.votes[msg.planId]=new Set(saved.votes||[]);if(saved.confirmed){r.planned=msg.plan;r.plannedId=msg.planId}else{checkPlanDone(id,msg);if(saved.votes?.length&&!r.plannedId)simulatePlanVotes(id,msg)}}}catch(e){}
}

/* 일정이 있는 데모 방은 새로고침 뒤에도 채팅 목록에서 바로 이어 간다. */
function restoreAvailabilityRooms(){
  try{for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key.startsWith('moonlight-availability-'))continue;
    const id=key.slice('moonlight-availability-'.length),saved=JSON.parse(localStorage.getItem(key));
    if(!saved?.msg?.plan?.schedule||!saved.meeting)continue;
    availabilitySlots(saved.msg.plan.schedule);
    if(!MEETINGS.some(m=>m.id===id))MEETINGS.push(saved.meeting);
    if(!S.joined.includes(id))S.joined.push(id);ensureRoom(id);restoreAvailability(id);
  }}catch(e){}
}
