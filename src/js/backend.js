/* ================= 백엔드 모드 (Supabase + Edge Functions) =================
   CONFIG가 비어 있으면 아래 함수들은 호출되지 않는다.
   서버 데이터를 PEOPLE / MEETINGS / S 와 같은 모양으로 채워 넣어 렌더 함수는 두 모드가 공유한다. */
let sb=null;      // supabase-js 클라이언트
let ME=null;      // 현재 사용자 id (auth.uid)
let CH=null;      // 열려 있는 채팅방의 Realtime 채널
const R={rec:null,recLoading:false,recDirty:true,saveTimer:null,seen:new Set()};
const ENTRY_MSG={
  INVALID_CODE:'입장 코드가 올바르지 않아요',
  EXPIRED_CODE:'입장 코드가 만료됐어요. 발표 화면의 새 코드를 확인해 주세요',
  RATE_LIMITED:'시도가 너무 많아요. 잠시 후 다시 시도해 주세요',
  CODE_EXHAUSTED:'입장 코드 사용 횟수를 초과했어요',
  NAME_MISMATCH:'사번과 이름이 일치하지 않아요. 입력 내용을 확인해 주세요',
  BAD_REQUEST:'계열사·사번·이름을 모두 입력해 주세요',
  UNAUTHORIZED:'세션이 만료됐어요. 다시 입장해 주세요',
  NETWORK:'네트워크 연결을 확인해 주세요 · 다시 시도',
};
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('script'));document.head.appendChild(s)})}
function fmtT(iso){const d=new Date(iso);if(isNaN(d))return '';const h=d.getHours();return (h<12?'오전 ':'오후 ')+((h%12)||12)+':'+String(d.getMinutes()).padStart(2,'0')}
function netFail(what){toast('네트워크 오류',(what||'요청')+'에 실패했어요 · 연결을 확인하고 다시 시도해 주세요')}
function showEntry(){
  if(!$('e-co').options.length)$('e-co').innerHTML=COMPANIES.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join('');
  $('entry').classList.add('on');entryErr('');
}
function hideEntry(){$('entry').classList.remove('on')}
function entryErr(m){$('e-err').textContent=m||''}

async function initBackend(){
  // 로컬 데모 데이터는 비우고 서버 데이터로만 채운다
  MEETINGS.length=0; Object.keys(PEOPLE).forEach(k=>delete PEOPLE[k]); Object.keys(S.met).forEach(k=>delete S.met[k]);
  S.joined=[]; S.rooms={};
  $('modehint').textContent='발표용 백엔드 모드 · 데이터는 Supabase에 저장됩니다';
  try{
    await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
    sb=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY);
    sb.auth.onAuthStateChange((ev,sess)=>{   // 갱신 실패로 로그아웃되면 로그인 화면으로
      if(ev==='SIGNED_OUT'){ME=null;showEntry()}
      else if(sess&&sess.user)ME=sess.user.id;
    });
    const {data:{session}}=await sb.auth.getSession();
    if(session){ME=session.user.id; if(await loadProfile()){await afterLogin();return}}
  }catch(e){netFail('초기화')}
  showEntry();
}
/* Edge Function 호출 · 오류 코드 추출 */
async function fnCode(error){
  try{ if(error&&error.context&&typeof error.context.json==='function'){const j=await error.context.json();return j.error_code||'UNKNOWN'} }catch(_){}
  return error&&error.name==='FunctionsFetchError'?'NETWORK':'UNKNOWN';
}
async function callFn(name,body,headers,retried){
  const {data,error}=await sb.functions.invoke(name,{body:body||{},headers:headers||{}});
  if(error){
    const code=await fnCode(error);
    if(code==='UNAUTHORIZED'){
      // 토큰이 막 만료된 경우: 세션을 갱신하고 한 번만 재시도한다. 갱신도 안 되면 그때 로그인 화면으로
      if(!retried){
        const {data:rs}=await sb.auth.refreshSession().catch(()=>({data:null}));
        if(rs&&rs.session){ME=rs.session.user.id;return callFn(name,body,headers,true)}
      }
      toast('세션 만료',ENTRY_MSG.UNAUTHORIZED);showEntry();
    }
    throw Object.assign(new Error(code),{code});
  }
  return data;
}
/* 발표 로그인: 입장 코드 + 계열사 + 사번 + 이름 → demo-login 이 결정적 계정을 만들거나 찾아 세션을 준다.
   같은 사번이면 어느 기기에서든 같은 프로필·채팅이 복원되고, 사번은 맞는데 이름이 다르면 거부된다. */
async function enterDemo(){
  const code=$('e-code').value.trim(), coId=$('e-co').value, emp=$('e-emp').value.trim(), name=$('e-name').value.trim(), nick=$('e-nick').value.trim();
  if(!/^\d{6}$/.test(code))return entryErr('입장 코드 6자리를 입력해 주세요');
  if(!coId||!emp||!name)return entryErr('계열사·사번·이름을 모두 입력해 주세요');
  const btn=$('e-btn'); btn.disabled=true; btn.textContent='확인 중…'; entryErr('');
  try{
    const d=await callFn('demo-login',{code,company_id:coId,employee_no:emp,real_name:name,nickname:nick});
    const {error}=await sb.auth.setSession(d.session); if(error)throw error;
    const {data:{session}}=await sb.auth.getSession(); if(!session)throw new Error('NO_SESSION');
    ME=session.user.id;
    if(!(await loadProfile()))throw Object.assign(new Error('NO_PROFILE'),{code:'NO_PROFILE'});
    hideEntry(); await afterLogin();
    toast(d.is_new?'환영해요 🌙':'다시 오셨네요 🌙',d.is_new?'프로필 탭에서 관심사와 선호 지역을 설정해 보세요':'저장된 프로필과 채팅을 불러왔어요');
  }catch(e){ entryErr(ENTRY_MSG[e.code]||'입장에 실패했어요. 다시 시도해 주세요') }
  finally{btn.disabled=false;btn.textContent='입장하기'}
}
/* 프로필 저장·복원 */
function profileRow(){
  const P=S.profile;
  return {user_id:ME,real_name:P.realName||P.nick,nickname:P.nick,avatar:P.av,company_id:P.company,region:P.regions[0]||null,regions:P.regions,age:P.age,
    gender:P.gender,mbti:P.mbti,interests:P.interests,hobbies:P.hobbies,group_size_min:P.sizeMin,group_size_max:P.sizeMax,
    matching_preferences:{same_gender:P.sameGender,scope:P.scope,direction:P.dir},updated_at:new Date().toISOString()};
}
async function saveProfile(){
  if(!BACKEND||!ME||!sb)return false;
  const {error}=await sb.from('profiles').upsert(profileRow());
  if(error){netFail('설정 저장');return false}
  R.recDirty=true; return true;
}
function profileChanged(){ S.dirty=true; renderSaveBtn(); }
async function loadProfile(){
  const {data,error}=await sb.from('profiles').select('*').eq('user_id',ME).maybeSingle();
  if(error||!data)return false;
  const P=S.profile, mp=data.matching_preferences||{};
  P.nick=data.nickname; P.realName=data.real_name; P.av=data.avatar||P.av; P.company=data.company_id||P.company;
  P.regions=(data.regions&&data.regions.length)?data.regions:(data.region?[data.region]:['판교']);
  P.age=data.age||P.age; P.gender=data.gender; P.mbti=data.mbti||P.mbti;
  P.interests=data.interests||[]; P.hobbies=data.hobbies||[]; P.sizeMin=data.group_size_min||4; P.sizeMax=data.group_size_max||6;
  P.sameGender=!!mp.same_gender; P.scope=mp.scope||'all'; P.dir=mp.direction||'wide';
  P.regions.forEach(v=>{if(!REGIONS.includes(v))REGIONS.push(v)});   // 직접 추가한 항목 복원
  S.dirty=false;
  P.interests.forEach(v=>{if(!INTS.includes(v))INTS.push(v)});
  P.hobbies.forEach(v=>{if(!HOBS.includes(v))HOBS.push(v)});
  return true;
}
async function afterLogin(){
  await Promise.all([loadConnections(),loadRooms()]);
  R.recDirty=true;
  renderHome();renderProfile();updateBdg();go('home');
  if(new URLSearchParams(location.search).get('admin')==='1')$('adminbox').style.display='block';
}
/* 커넥션 → S.met / PEOPLE (홈 행성 점등·위성) */
async function loadConnections(){
  const {data,error}=await sb.rpc('my_connections'); if(error){netFail('커넥션 조회');return}
  Object.keys(S.met).forEach(k=>delete S.met[k]);
  (data||[]).forEach(p=>{PEOPLE[p.user_id]={real:p.real_name,nick:p.nickname,co:p.company_id,av:p.avatar||'🌙'};S.met[p.user_id]=true});
}
function ensureMeeting(id,patch){
  let m=MEETINGS.find(x=>x.id===id);
  if(!m){m={id,em:'🌙',name:'',region:'',when:'',cap:6,tags:[],members:[],ai:''};MEETINGS.push(m)}
  Object.assign(m,patch); return m;
}
function ensureRoom(id){return S.rooms[id]||(S.rooms[id]={msgs:[],unread:0,planned:null,revealed:false,completed:false,photos:[],votes:{},attended:new Set(),iAttended:false})}
/* 채팅 목록 (room_summaries RPC) */
async function loadRooms(){
  const {data,error}=await sb.rpc('room_summaries'); if(error){netFail('채팅 목록');return}
  S.joined=(data||[]).map(x=>x.meeting_id);
  (data||[]).forEach(x=>{
    const m=ensureMeeting(x.meeting_id,{em:x.emoji||'🌙',name:x.title,memberCount:Math.max(0,(x.member_count||1)-1)});
    const r=ensureRoom(x.meeting_id);
    r.completed=x.status==='completed';                 // 모임 전체 완료 여부 (모임 상태) — #4
    r.iAttended=!!x.attended; r.revealed=r.iAttended;    // 내 체크인 여부 (room_summaries.attended)
    r.last=x.last_body; r.lastT=x.last_at?fmtT(x.last_at):'';
    if(r.iAttended&&!r.photos.length)r.photos=placeholderPhotos(m);
  });
}
/* AI 매칭 (recommend-meetings Edge Function) */
async function loadRecommendations(){
  if(R.recLoading)return;
  if(R.rec&&!R.recDirty){renderMatchCards(R.rec.list,R.rec.note);return}
  R.recLoading=true;
  $('matchnote').innerHTML='';
  $('meets').innerHTML='<div class="empty"><i>🌙</i>MoonLight AI가 프로필을 읽고<br>어울리는 모임을 고르는 중이에요…</div>';
  try{
    const d=await callFn('recommend-meetings',{});
    const byId={};
    (d.candidates||[]).forEach(c=>{
      byId[c.id]=ensureMeeting(c.id,{em:c.emoji||'🌙',name:c.title,region:c.region,when:c.when_label,cap:c.capacity,tags:c.tags||[],
        memberCount:Math.max(0,(c.member_count||0)-(c.joined?1:0)),knownCount:c.known_count||0,mine:!!c.mine});
      if(c.joined&&!S.joined.includes(c.id))S.joined.push(c.id);
    });
    const list=[];
    (d.recommendations||[]).forEach(rc=>{
      const m=byId[rc.meeting_id]; if(!m||list.includes(m))return;
      m.ai=esc(rc.reason||'')+((rc.cautions||[]).length?' <span style="color:var(--tx3)">· '+esc(rc.cautions.join(' · '))+'</span>':'');
      list.push(m);
    });
    Object.values(byId).forEach(m=>{if(!list.includes(m)){m.ai=m.ai||'기본 추천';list.push(m)}});
    const note=d.fallback?'☁️ AI 응답이 지연되어 기본 추천을 보여드려요':'';
    R.rec={list,note,model:d.model}; R.recDirty=false;
    renderMatchCards(list,note);
  }catch(e){
    $('meets').innerHTML='<div class="empty"><i>☁️</i>추천을 불러오지 못했어요.<br><button class="cta line" style="margin-top:14px" onclick="R.recDirty=true;loadRecommendations()">다시 시도</button></div>';
  }finally{R.recLoading=false}
}
/* 채팅방 로드 · Realtime */
function upsertMember(p){ if(p.user_id===ME)return; PEOPLE[p.user_id]={real:p.real_name,nick:p.nickname,co:p.company_id,av:p.avatar||'🌙'} }
async function refreshMembers(id){
  const {data,error}=await sb.rpc('room_members',{p_meeting_id:id}); if(error)return;
  const m=ensureMeeting(id,{}); m.members=[];
  (data||[]).forEach(p=>{if(p.user_id===ME)return;m.members.push(p.user_id);upsertMember(p)});
  m.memberCount=m.members.length;
}
function pushMsg(r,x){
  if(!x||R.seen.has(x.id))return false; R.seen.add(x.id);
  r.msgs.push({id:x.id,f:x.sender_id===ME?'me':x.sender_id,x:x.body,t:fmtT(x.created_at)}); return true;
}
function applyPlan(r,pl){
  if(!pl||!pl.id)return;
  const plan={place:pl.place||'',when:pl.time_label||'',meetAt:pl.meet_at||null,act:pl.activity||'',food:(pl.nearby||[]).join(' · '),cands:Array.isArray(pl.candidates)?pl.candidates:[]};
  let msg=r.msgs.find(m=>m.f==='ai'&&m.planId===pl.id);
  if(!msg){
    if(!r.msgs.some(m=>m.f==='ai'))r.msgs.push({f:'sys',x:'MoonLight AI가 지금까지의 대화를 바탕으로 약속을 제안했어요'});
    msg={f:'ai',plan,planId:pl.id,t:fmtT(pl.created_at)||nowT()}; r.msgs.push(msg);
  }
  msg.plan=plan; msg.source=pl.source;
  // 서버가 전원 투표(vote) 또는 약속 시간 경과(due) 로 confirmed 를 켠다.
  // 서버 정리가 아직 안 돌았어도 meet_at 이 지났으면 화면에서는 먼저 확정으로 본다.
  const due=planDue(plan);
  if((pl.confirmed||due)&&r.plannedId!==pl.id){
    r.planned=plan; r.plannedId=pl.id;
    const reason=(pl.confirm_reason==='due'||(!pl.confirmed&&due))?'due':'vote';
    if(!r.msgs.some(m=>m.confirmOf===pl.id))r.msgs.push({f:'sys',confirmOf:pl.id,x:planDoneMsg(reason,plan)});
  }
}
async function loadRoom(id){
  try{ await sb.rpc('settle_due_plans',{p_meeting_id:id}) }catch(e){}   // 시간이 지난 약속을 먼저 확정한다
  const [mem,msgs,plans,votes,att,fb]=await Promise.all([
    sb.rpc('room_members',{p_meeting_id:id}),
    sb.from('messages').select('id,sender_id,body,created_at').eq('meeting_id',id).order('created_at',{ascending:false}).limit(50),
    sb.from('meeting_plans').select('*').eq('meeting_id',id).order('created_at',{ascending:false}).limit(1),
    sb.from('meeting_plan_votes').select('plan_id,user_id').eq('meeting_id',id),
    sb.from('meeting_attendance').select('user_id').eq('meeting_id',id),
    sb.from('meeting_feedback').select('rating').eq('meeting_id',id).eq('user_id',ME).maybeSingle(),
  ]);
  if(mem.error||msgs.error||plans.error||votes.error||att.error)throw new Error('load');
  const m=ensureMeeting(id,{}), r=ensureRoom(id);
  m.members=[]; (mem.data||[]).forEach(p=>{if(p.user_id===ME)return;m.members.push(p.user_id);upsertMember(p)});
  m.memberCount=m.members.length;
  r.votes={}; (votes.data||[]).forEach(v=>{(r.votes[v.plan_id]||(r.votes[v.plan_id]=new Set())).add(v.user_id)});
  r.attended=new Set((att.data||[]).map(a=>a.user_id)); r.iAttended=r.attended.has(ME); r.revealed=r.iAttended;
  r.myRating=(fb&&fb.data&&fb.data.rating)?Number(fb.data.rating):0;
  if(r.iAttended&&!r.photos.length)r.photos=placeholderPhotos(m);
  r.planned=null; r.plannedId=null;
  R.seen.clear();
  r.msgs=[{f:'sys',x:r.iAttended?'🌕 만남을 완료한 모임이에요. 함께 완료한 동료는 실명으로 보여요':'모임이 열렸어요. 만나기 전까지는 서로 익명이에요 🌙'}];
  (msgs.data||[]).slice().reverse().forEach(x=>pushMsg(r,x));
  const pl=(plans.data||[])[0]; if(pl){applyPlan(r,pl); const am=r.msgs.find(x=>x.planId===pl.id); if(am)checkPlanDone(id,am);}
}
function subscribeRoom(id){
  unsubscribeRoom();
  CH=sb.channel('room-'+id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'meeting_id=eq.'+id},async p=>{
      const r=S.rooms[id]; if(!r||!p.new)return;
      if(p.new.sender_id!==ME&&!PEOPLE[p.new.sender_id])await refreshMembers(id);   // 새로 들어온 멤버
      if(pushMsg(r,p.new)&&CUR===id)renderMsgs();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'meeting_plans',filter:'meeting_id=eq.'+id},p=>{
      const r=S.rooms[id]; if(!r||!p.new)return;
      applyPlan(r,p.new); if(CUR===id){renderBanner();renderMsgs()}
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'meeting_plan_votes',filter:'meeting_id=eq.'+id},p=>{
      const r=S.rooms[id]; if(!r||!p.new)return;
      (r.votes[p.new.plan_id]||(r.votes[p.new.plan_id]=new Set())).add(p.new.user_id);
      const msg=r.msgs.find(x=>x.planId===p.new.plan_id); if(msg)checkPlanDone(id,msg);
      if(CUR===id){renderMsgs();renderBanner()}
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'meeting_attendance',filter:'meeting_id=eq.'+id},async p=>{
      const r=S.rooms[id]; if(!r||!p.new)return;
      r.attended.add(p.new.user_id);
      if(p.new.user_id!==ME){
        await Promise.all([refreshMembers(id),loadConnections()]);   // 서로 완료했다면 이제 실명이 내려온다
        const who=PEOPLE[p.new.user_id]||UNKNOWN, linked=!!(S.met[p.new.user_id]&&who.real);
        r.msgs.push({f:'sys',x:'🌕 '+(linked?who.real:who.nick)+' 님이 만남을 완료했어요'+(linked?' — 이제 실명으로 보여요':r.iAttended?'':' · 나도 완료하면 서로 이름이 보여요')});
      }
      if(CUR===id){renderMsgs();renderBanner();renderMeta(id)}
    })
    .subscribe();
}
function unsubscribeRoom(){ if(CH&&sb){sb.removeChannel(CH);CH=null} }
/* 발표 데이터 초기화 (관리 토큰 필요 · ?admin=1 일 때만 버튼 노출) */
async function resetDemo(){
  const tok=window.prompt('관리 토큰을 입력하세요'); if(!tok)return;
  try{ await callFn('reset-demo',{},{'x-demo-reset-token':tok}); toast('초기화 완료','발표 데이터를 비웠어요'); setTimeout(()=>location.reload(),900); }
  catch(e){ toast('초기화 실패',e.code==='FORBIDDEN'?'토큰이 올바르지 않아요':'다시 시도해 주세요') }
}

