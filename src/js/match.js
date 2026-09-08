/* ================= 매칭 ================= */
function knownIn(m){return m.knownCount!=null?m.knownCount:m.members.filter(p=>S.met[p]).length}
function memberTotal(m){return m.memberCount!=null?m.memberCount:m.members.length}
/* 매칭 탭 빠른 필터 — 전체 · 선호 지역별 · 내가 만든 모임 (추천 목록을 다시 받지 않고 화면에서만 거른다) */
const MF={region:null,mine:false};
function setFilter(k,v){
  if(k==='region'){MF.region=MF.region===v?null:v;MF.mine=false}
  else if(k==='mine'){MF.mine=!MF.mine;MF.region=null}
  else {MF.region=null;MF.mine=false}
  renderMatch();
}
function renderFilters(){
  const regs=[...new Set(savedProfile().regions)];
  if(MF.region&&!regs.includes(MF.region))MF.region=null;   // 프로필에서 뺀 지역의 필터는 자동으로 푼다
  $('mfilters').innerHTML='<button class="chip'+(!MF.region&&!MF.mine?' on':'')+'" onclick="setFilter(\'all\')">전체</button>'
    +regs.map(r=>'<button class="chip'+(MF.region===r?' on':'')+'" data-mf-region="'+esc(r)+'">'+ico('pin')+esc(r)+'</button>').join('')
    +'<button class="chip'+(MF.mine?' on':'')+'" onclick="setFilter(\'mine\')">내가 만든 모임</button>';
}
function renderMatch(){
  const P=savedProfile(), c=co(P.company);   // 저장된 프로필 기준 (저장 전 변경은 반영되지 않는다)
  $('matchsub').innerHTML='<div class="pf"><span><b>'+esc(P.nick)+'</b>님 기준</span><span>·</span><span>'+esc(c?c.name:'')+'</span><span>·</span><span>'+esc(P.regions.join(' · '))+'</span><span>·</span><span>'+P.sizeMin+'~'+P.sizeMax+'명</span></div>'
    +(S.dirty?'<button class="edit warn" onclick="go(\'profile\')">저장 안 됨 · 저장</button>':'<button class="edit" onclick="go(\'profile\')">설정 변경</button>');
  renderFilters();
  if(BACKEND){loadRecommendations();return}
  // 선호 지역 밖 모임은 무조건 제외한다 (서버 모드에서도 같은 규칙)
  const list=MEETINGS.filter(m=>P.regions.includes(m.region)).sort((a,b)=>{
    if(!!a.mine!==!!b.mine)return a.mine?-1:1;   // 내가 만든 모임은 맨 위 (서버 모드와 같은 규칙)
    const ka=knownIn(a)/(a.members.length||1), kb=knownIn(b)/(b.members.length||1);
    return P.dir==='deep'? kb-ka : ka-kb;
  });
  renderMatchCards(list,'');
}
function renderMatchCards(list,note){
  $('matchnote').innerHTML=note||'';
  const P=savedProfile(), mineSet=new Set([...P.interests,...P.hobbies]);
  const shownList=list.filter(m=>(!MF.region||m.region===MF.region)&&(!MF.mine||m.mine));
  if(!list.length){
    $('meets').innerHTML='<div class="empty"><i>🌘</i><b>모임을 찾지 못했어요</b>선호 지역('+esc(P.regions.join('·'))+')에 열린 모임이 없어요.<br>프로필에서 지역을 늘리거나 오른쪽 아래 ‘모임 만들기’를 눌러 보세요.</div>';
    return;
  }
  if(!shownList.length){
    $('meets').innerHTML='<div class="empty"><i>🔭</i><b>이 조건의 모임이 없어요</b>필터를 바꾸거나 전체 보기로 돌아가 보세요.'
      +'<button class="cta line sm" onclick="setFilter(\'all\')">전체 보기</button></div>';
    return;
  }
  $('meets').innerHTML=shownList.map(m=>{
    // memberCount 는 나를 제외한 인원. 표시 인원은 참가 중이면 나를 더해 채팅 목록과 같은 수를 보여준다 (#3)
    const others=memberTotal(m), kn=knownIn(m), ratio=others?Math.round(kn/others*100):0;
    const joined=S.joined.includes(m.id), shown=joined?roomTotal(m.id):others, full=!joined&&others>=m.cap;   // 정원이 찼으면 미리 알린다
    const avs=(m.members||[]).slice(0,4).map(pid=>'<span>'+esc((PEOPLE[pid]||{}).av||'🌙')+'</span>').join('')
      +(others>4?'<span class="more">+'+(others-4)+'</span>':'');
    const badge=m.mine?'<span class="badge">내 모임</span>':'';
    return '<div class="card meet'+(joined?' joined':'')+'">'
      +'<div class="hd press" role="button" onclick="openDetail(\''+m.id+'\')"><div class="em">'+esc(m.em||'🌙')+'</div><div style="flex:1;min-width:0">'
      +'<h3>'+esc(m.name)+'</h3>'
      +'<div class="meta"><span>'+ico('pin')+esc(m.region)+'</span><span>'+ico('clock')+esc(m.when)+'</span><span>'+ico('users')+shown+'/'+m.cap+'명</span></div>'
      +'</div>'+badge+'</div>'
      +'<div class="tags">'+m.tags.map(t=>'<span class="tag'+(mineSet.has(t)?' or':'')+'">#'+esc(t)+'</span>').join('')+'</div>'
      +'<div class="ft"><div class="who">'+(avs?'<span class="avs">'+avs+'</span>':'')
      +'<span class="k">'+(kn?'아는 얼굴 <b>'+kn+'명</b> · 처음 보는 '+(others-kn)+'명':others?'모두 새로운 만남 · '+others+'명':'첫 멤버를 기다리는 중')+'</span></div></div>'
      +(kn?'<div class="band"><div class="bar"><div class="fill" style="width:'+ratio+'%"></div></div><span class="lb">아는 얼굴 <b>'+ratio+'%</b></span></div>':'')
      +(joined
        ?'<button class="cta soft" onclick="openJoined(\''+m.id+'\')">'+ico('check')+'참가 중 · 채팅방 열기</button>'
        :full?'<button class="cta" disabled>정원 마감 · '+others+'/'+m.cap+'명</button>'
        :'<button class="cta line" onclick="joinMeet(\''+m.id+'\')">참가하기</button>')
      +'</div>';
  }).join('');
}
async function joinMeet(id){
  const m=MEETINGS.find(x=>x.id===id);
  if(BACKEND){
    // 참가·정원·마감 검사는 원자적인 서버 RPC에서 처리한다 (#11 후속 보완)
    const {error}=await sb.rpc('join_meeting',{p_meeting_id:id});
    if(error){
      // 42501 = 정책·정원 트리거가 막은 참가. 화면이 낡았을 수 있으니 추천 목록을 다시 받는다
      if(error.code==='42501'){toast('참가할 수 없어요','정원이 찼거나 마감된 모임이에요');await loadRecommendations();return}
      netFail('모임 참가');return;
    }
    if(!S.joined.includes(id))S.joined.push(id);
    await loadRooms();
    if(R.rec)renderMatchCards(R.rec.list,R.rec.note);
    toast('참가 완료','<b>'+esc(m.name)+'</b> 채팅방이 열렸어요 · 참가 이전 대화는 보이지 않아요');
    return;
  }
  S.joined.push(id);
  const seed=[
    {f:'sys',  x:'모임이 열렸어요. 만나기 전까지는 서로 익명이에요 🌙'},
    {f:m.members[0], x:'안녕하세요! 다들 반가워요 ☺️', t:'오후 6:02', dk:dayKey()},
    {f:m.members[1]||m.members[0], x:'와 '+m.tags[0]+' 얘기 나눌 사람 찾고 있었는데 반갑네요!', t:'오후 6:05', dk:dayKey()},
  ];
  Object.assign(ensureRoom(id),{msgs:seed,unread:2});
  updateBdg();renderMatch();
  toast('참가 완료','<b>'+esc(m.name)+'</b> 채팅방이 열렸어요');
}


/* ================= 모임 상세 시트 — 참가 전에 멤버·태그·추천 이유를 보고 결정한다 ================= */
function openDetail(id){
  const m=MEETINGS.find(x=>x.id===id); if(!m)return;
  const P=savedProfile(), mineSet=new Set([...P.interests,...P.hobbies]);
  const joined=S.joined.includes(id), others=memberTotal(m), kn=knownIn(m), full=!joined&&others>=m.cap;
  const mem=(m.members||[]).map(pid=>{
    const p=PEOPLE[pid]||UNKNOWN, known=!!(S.met[pid]&&p.real), c=co(p.co);
    return '<div class="memrow"><div class="mav">'+esc(p.av||'🌙')+'</div><div class="nm"><b>'+esc(known?p.real:p.nick)+'</b><small>'+esc(known?(c?c.name:''):'익명 · 만나면 실명이 보여요')+'</small>'
      +((p.ints||[]).length?'<span class="mtags">'+p.ints.slice(0,3).map(t=>'<i>#'+esc(t)+'</i>').join('')+'</span>':'')+'</div>'
      +(known?'<span class="mbadge on">아는 얼굴</span>':'')+'</div>';
  }).join('');
  $('dt-body').innerHTML='<div class="dthd"><div class="em">'+esc(m.em||'🌙')+'</div><div style="min-width:0"><b>'+esc(m.name)+'</b>'
    +'<div class="meta"><span>'+ico('pin')+esc(m.region)+'</span><span>'+ico('clock')+esc(m.when)+'</span><span>'+ico('users')+(joined?roomTotal(id):others)+'/'+m.cap+'명</span></div></div></div>'
    +'<div class="tags" style="margin-top:12px">'+(m.mine?'<span class="tag or">내 모임</span>':'')+m.tags.map(t=>'<span class="tag'+(mineSet.has(t)?' or':'')+'">#'+esc(t)+'</span>').join('')+'</div>'
    +'<div class="ai" style="margin-top:12px"><span class="mi">🌙</span><div><span class="lb">MoonLight AI 추천 이유</span>'+m.ai+'</div></div>'
    +'<div class="sec" style="margin:16px 0 4px"><h2 style="font-size:14.5px">멤버</h2><small>'+(kn?'아는 얼굴 '+kn+'명 · ':'')+others+'명</small></div>'
    +(mem||'<p class="hint">멤버 목록은 참가하면 채팅방에서 볼 수 있어요'+(others?' · 지금 '+others+'명이 있어요':' · 첫 멤버를 기다리는 중')+'</p>')
    +'<p class="hint" style="margin-top:10px">만나기 전까지는 서로 익명이고, 참가 이전 대화는 보이지 않아요</p>';
  $('dt-cta').innerHTML=joined
    ?'<button class="cta soft" onclick="hideDetail();openJoined(\''+id+'\')">'+ico('check')+'참가 중 · 채팅방 열기</button>'
    :full?'<button class="cta" disabled>정원 마감 · '+others+'/'+m.cap+'명</button>'
    :'<button class="cta" onclick="hideDetail();joinMeet(\''+id+'\')">참가하기</button>';
  $('detailwrap').classList.add('on');
}
function hideDetail(){$('detailwrap').classList.remove('on')}

/* ================= 모임 만들기 ================= */
const C={em:'🌙',region:null,tags:[],when:'평일 저녁',cap:6,invite:[]};
function openCreate(){
  C.em='🌙'; C.region=S.profile.regions[0]||REGIONS[0]; C.tags=[]; C.when='평일 저녁'; C.cap=Math.max(2,Math.min(10,S.profile.sizeMax||6)); C.invite=[];
  $('c-name').value=''; $('c-err').textContent='';
  renderCreate(); $('createwrap').classList.add('on');
}
function hideCreate(){$('createwrap').classList.remove('on')}
function cset(k,v){C[k]=v;renderCreate()}
function ctag(v){const i=C.tags.indexOf(v);i<0?C.tags.push(v):C.tags.splice(i,1);renderCreate()}
function bumpCap(d){C.cap=Math.max(2,Math.min(10,C.cap+d));renderCreate()}
function cinv(pid){const i=C.invite.indexOf(pid);i<0?C.invite.push(pid):C.invite.splice(i,1);renderCreate()}
function renderCreate(){
  // 친구 초대 후보 = 나와 연결된(서로 만남 완료한) 사람
  const friends=Object.keys(S.met).filter(pid=>PEOPLE[pid]&&PEOPLE[pid].real);
  $('c-invite').innerHTML=friends.length
    ?friends.map(pid=>{const p=PEOPLE[pid],c=co(p.co);return '<button class="chip'+(C.invite.includes(pid)?' on':'')+'" onclick="cinv(\''+pid+'\')">'+esc(p.av||'🌙')+' '+esc(p.real)+(c?' · '+esc(c.name):'')+'</button>'}).join('')
    :'<p class="hint">아직 연결된 친구가 없어요. 만남을 완료해 연결되면 여기서 초대할 수 있어요.</p>';
  $('c-emoji').innerHTML=EMOJIS.map(e=>'<button class="'+(C.em===e?'on':'')+'" onclick="cset(\'em\',\''+e+'\')">'+e+'</button>').join('');
  $('c-region').innerHTML=REGIONS.map(r=>'<option value="'+esc(r)+'"'+(C.region===r?' selected':'')+'>'+esc(r)+'</option>').join('');
  const pool=[...new Set([...INTS,...HOBS])];
  $('c-tags').innerHTML=pool.map(v=>'<button class="chip'+(C.tags.includes(v)?' on':'')+'" data-create-kind="tag" data-v="'+esc(v)+'">'+esc(v)+'</button>').join('');
  $('c-when').innerHTML=WHENS.map(w=>'<button class="chip'+(C.when===w?' on':'')+'" onclick="cset(\'when\',\''+w+'\')">'+w+'</button>').join('');
  $('c-cap').textContent=C.cap+'명';
}
async function submitCreate(){
  const name=$('c-name').value.trim();
  if(!name)return $('c-err').textContent='모임 이름을 입력해 주세요';
  if(!C.region)return $('c-err').textContent='지역을 선택해 주세요';
  if(!C.tags.length)return $('c-err').textContent='관심사나 취미를 1개 이상 골라 주세요';
  const btn=$('c-btn'); btn.disabled=true; btn.textContent='만드는 중…';
  try{
    let id;
    if(BACKEND){
      const {data,error}=await sb.from('meetings').insert({title:name,emoji:C.em,tags:C.tags,region:C.region,when_label:C.when,capacity:C.cap,created_by:ME}).select('id').single();
      if(error)throw error; id=data.id;
      const m=ensureMeeting(id,{em:C.em,name,region:C.region,when:C.when,cap:C.cap,tags:[...C.tags],memberCount:0,knownCount:0,mine:true,ai:'내가 만든 모임 — 관심사가 맞는 동료에게 AI가 추천해요'});
      while(R.recLoading)await new Promise(r=>setTimeout(r,200));   // 추천 로딩 중이면 끝난 뒤에 카드를 끼워 넣는다 (덮어쓰기 방지)
      if(R.rec){R.rec.list=[m,...R.rec.list.filter(x=>x.id!==id)]}
      await joinMeet(id);   // 만든 사람은 바로 참가 · 채팅방 생성
      if(C.invite.length){   // 연결된 친구 초대 (서버가 방장·연결 여부를 검증)
        const {data:n,error:ie}=await sb.rpc('invite_to_meeting',{p_meeting_id:id,p_user_ids:C.invite});
        if(ie)toast('초대 실패','친구 초대를 완료하지 못했어요 · 방은 만들어졌어요');
        else {toast('초대 완료','친구 '+(n||0)+'명을 모임에 초대했어요'); await loadRooms(); if(R.rec)renderMatchCards(R.rec.list,R.rec.note);}
      }
    }else{
      id='u'+Date.now();
      const invited=[...C.invite], names=invited.map(p=>PEOPLE[p].real).join(', ');
      MEETINGS.unshift({id,em:C.em,name,region:C.region,when:C.when,cap:C.cap,tags:[...C.tags],members:invited,mine:true,ai:'내가 만든 모임 — 관심사가 맞는 동료가 참가하면 채팅이 시작돼요'});
      S.joined.push(id);
      Object.assign(ensureRoom(id),{msgs:[{f:'sys',x:'모임을 열었어요. 관심사가 맞는 동료가 참가하면 여기서 익명으로 대화해요 🌙'+(invited.length?' · '+names+' 님을 초대했어요':'')}]});
      updateBdg(); renderMatch();
      toast('모임 생성','<b>'+esc(name)+'</b> 채팅방이 열렸어요');
    }
    hideCreate();
    go('chat'); await openRoom(id);   // 만든 방으로 바로 들어간다
  }catch(e){ $('c-err').textContent='모임을 만들지 못했어요 · 다시 시도해 주세요' }
  finally{btn.disabled=false;btn.textContent='모임 만들기'}
}
