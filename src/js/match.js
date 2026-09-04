/* ================= 매칭 ================= */
function knownIn(m){return m.knownCount!=null?m.knownCount:m.members.filter(p=>S.met[p]).length}
function memberTotal(m){return m.memberCount!=null?m.memberCount:m.members.length}
function renderMatch(){
  const P=S.profile;
  $('matchsub').innerHTML='<b style="color:var(--orange-soft)">'+esc(P.nick)+'</b>님의 설정 — '+co(P.company).name+' · '+esc(P.regions.join('·'))+' · '+P.sizeMin+'~'+P.sizeMax+'명 기준으로 골랐어요.';
  if(BACKEND){loadRecommendations();return}
  // 선호 지역 밖 모임은 무조건 제외한다 (서버 모드에서도 같은 규칙)
  const list=MEETINGS.filter(m=>P.regions.includes(m.region)).sort((a,b)=>{
    const ka=knownIn(a)/(a.members.length||1), kb=knownIn(b)/(b.members.length||1);
    return P.dir==='deep'? kb-ka : ka-kb;
  });
  renderMatchCards(list,'');
}
function renderMatchCards(list,note){
  $('matchnote').innerHTML=note||'';
  if(!list.length){
    $('meets').innerHTML='<div class="empty"><i>🌘</i>선호 지역('+esc(S.profile.regions.join('·'))+')에 열린 모임이 없어요.<br>프로필에서 지역을 늘리거나 위에서 직접 만들어 보세요.</div>';
    return;
  }
  $('meets').innerHTML=list.map(m=>{
    // memberCount 는 나를 제외한 인원. 표시 인원은 참가 중이면 나를 더해 채팅 목록과 같은 수를 보여준다 (#3)
    const others=memberTotal(m), kn=knownIn(m), ratio=others?Math.round(kn/others*100):0;
    const joined=S.joined.includes(m.id), shown=others+(joined?1:0);
    return '<div class="card meet">'
      +'<div class="hd"><div class="em">'+m.em+'</div><div style="flex:1">'
      +'<h3>'+esc(m.name)+'</h3><div class="meta">'+esc(m.region)+' · '+esc(m.when)+' · '+shown+'명 참여 중 / 정원 '+m.cap+'</div>'
      +'<div style="margin-top:7px">'+(m.mine?'<span class="tag" style="color:var(--orange-soft);background:rgba(243,115,33,.14)">내가 만든 모임</span>':'')+m.tags.map(t=>'<span class="tag">#'+esc(t)+'</span>').join('')+'</div>'
      +'</div></div>'
      +'<div class="ai">🌙 <b>AI 추천 이유</b> — '+m.ai+'</div>'
      +'<div class="band"><div class="bar"><div class="fill" style="width:'+ratio+'%"></div></div>'
      +'<div class="lb"><span>'+(kn? '아는 얼굴 <b>'+kn+'명</b> / '+others+'명':'모두 새로운 만남')+'</span><span>'+ratio+'%</span></div></div>'
      +'<button class="cta" '+(joined?'disabled':'')+' onclick="joinMeet(\''+m.id+'\')">'+(joined?'참가 완료 · 채팅 탭에서 확인':'참가')+'</button>'
      +'</div>';
  }).join('');
}
async function joinMeet(id){
  const m=MEETINGS.find(x=>x.id===id);
  if(BACKEND){
    // 중복 참가는 무시(no-op). RLS: 본인 행만 insert 가능
    const {error}=await sb.from('meeting_members').upsert({meeting_id:id,user_id:ME},{onConflict:'meeting_id,user_id',ignoreDuplicates:true});
    if(error){netFail('모임 참가');return}
    if(!S.joined.includes(id))S.joined.push(id);
    await loadRooms();
    if(R.rec)renderMatchCards(R.rec.list,R.rec.note);
    toast('참가 완료','<b>'+esc(m.name)+'</b> 채팅방이 열렸어요');
    return;
  }
  S.joined.push(id);
  const seed=[
    {f:'sys',  x:'모임이 열렸어요. 만나기 전까지는 서로 익명이에요 🌙'},
    {f:m.members[0], x:'안녕하세요! 다들 반가워요 ☺️', t:'오후 6:02'},
    {f:m.members[1]||m.members[0], x:'와 '+m.tags[0]+' 얘기 나눌 사람 찾고 있었는데 반갑네요!', t:'오후 6:05'},
  ];
  S.rooms[id]={msgs:seed,unread:2,planned:null,revealed:false,photos:[],votes:{},attended:new Set(),iAttended:false};
  updateBdg();renderMatch();
  toast('참가 완료','<b>'+esc(m.name)+'</b> 채팅방이 열렸어요');
}


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
    ?friends.map(pid=>{const p=PEOPLE[pid],c=co(p.co);return '<button class="chip'+(C.invite.includes(pid)?' on':'')+'" onclick="cinv(\''+pid+'\')">'+p.av+' '+esc(p.real)+(c?' · '+esc(c.name):'')+'</button>'}).join('')
    :'<p class="hint">아직 연결된 친구가 없어요. 만남을 완료해 연결되면 여기서 초대할 수 있어요.</p>';
  $('c-emoji').innerHTML=EMOJIS.map(e=>'<button class="'+(C.em===e?'on':'')+'" onclick="cset(\'em\',\''+e+'\')">'+e+'</button>').join('');
  $('c-region').innerHTML=REGIONS.map(r=>'<button class="chip'+(C.region===r?' on':'')+'" data-create-kind="region" data-v="'+esc(r)+'">'+esc(r)+'</button>').join('');
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
      S.rooms[id]={msgs:[{f:'sys',x:'모임을 열었어요. 관심사가 맞는 동료가 참가하면 여기서 익명으로 대화해요 🌙'+(invited.length?' · '+names+' 님을 초대했어요':'')}],unread:0,planned:null,revealed:false,photos:[],votes:{},attended:new Set(),iAttended:false};
      updateBdg(); renderMatch();
      toast('모임 생성','<b>'+esc(name)+'</b> 채팅방이 열렸어요');
    }
    hideCreate();
  }catch(e){ $('c-err').textContent='모임을 만들지 못했어요 · 다시 시도해 주세요' }
  finally{btn.disabled=false;btn.textContent='모임 만들기'}
}

