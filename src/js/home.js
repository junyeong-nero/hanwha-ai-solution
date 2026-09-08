/* ================= 홈: 회전하는 계열사 은하계 =================
   아는 사람이 생긴 계열사(+ 내 계열사)만 이 은하계에 합류한다 — 만남이 늘수록 우주가 넓어진다.
   행성은 궤도를 따라 계속 돌고, 궤도마다 회전 속도가 다르며 시작 각도도 궤도·슬롯마다 어긋나 있다.
   한 번 정한 궤도·슬롯은 S.homeOrbit.slots 에 남아 세션 내내 그대로 다시 쓰인다. */
const HOME_RING_CAPS=[6,11,16];        // 안쪽 궤도부터 담을 수 있는 행성 수 (합 33 ≥ 전체 계열사 수)
const HOME_RING_FRACS=[1/3,2/3,1];     // 궤도 반지름 비율 — 속도가 달라 언젠가 반경 방향으로 겹치므로
                                       // 궤도 간격(320px 기준 44.7px)을 터치 타겟 44px 이상으로 벌려 둔다
const HOME_RING_SECS=[34,53,76];       // 궤도별 한 바퀴 도는 시간(초) — 안쪽 궤도일수록 빠르게 돈다
const HOME_PAD=26;                     // 44px 터치 타겟이 잘리지 않도록 남기는 가장자리 여백(px)

function activeCompanies(){
  const set=new Set();
  Object.keys(S.met).forEach(pid=>{const p=PEOPLE[pid];if(p)set.add(p.co)});
  return set;
}

/* 시드 해시 — 같은 (세션 시드, key)면 언제나 같은 0~1 값이 나온다 */
function homeRand(key){
  let h=(S.homeOrbit.seed^0x9e3779b9)>>>0;
  const s=String(key);
  for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193)>>>0;
  h=Math.imul(h^(h>>>15),0x2545f491)>>>0;
  return ((h^(h>>>16))>>>0)/4294967296;
}

/* 은하계에 떠 있는 계열사 — 아는 사람이 생긴 계열사 + 내 계열사 */
function visibleCompanies(){
  const act=activeCompanies();
  return COMPANIES.filter(c=>act.has(c.id)||c.id===S.profile.company);
}

/* 궤도 슬롯 배치 — 안쪽 궤도부터 채우고, 같은 궤도에서는 이미 찬 슬롯과 가장 멀리 떨어진 자리를 고른다.
   슬롯이 궤도를 균등 분할하므로 같은 궤도 안에서도 행성 간격이 터치 타겟 아래로 좁아지지 않는다. */
function placeHomePlanet(id){
  const g=S.homeOrbit;
  if(g.slots[id])return g.slots[id];
  const used={};
  Object.keys(g.slots).forEach(k=>{const s=g.slots[k];(used[s.ring]=used[s.ring]||new Set()).add(s.slot)});
  for(let ring=0;ring<HOME_RING_CAPS.length;ring++){
    const cap=HOME_RING_CAPS[ring], taken=used[ring]||new Set();
    if(taken.size>=cap)continue;
    let best=0, bestScore=-1;
    for(let slot=0;slot<cap;slot++){
      if(taken.has(slot))continue;
      const gap=taken.size?Math.min.apply(null,Array.from(taken).map(t=>slotGap(slot,t,cap))):cap;
      const score=gap+homeRand(id+':'+ring+':'+slot)*.5;   // 간격이 같으면 시드로 갈라 세션마다 다른 모양이 나오게
      if(score>bestScore){bestScore=score;best=slot}
    }
    g.slots[id]={ring,slot:best};
    g.entering.add(id);
    return g.slots[id];
  }
  return g.slots[id]={ring:HOME_RING_CAPS.length-1,slot:0};   // 슬롯 합(33)이 계열사 수보다 많아 실제로는 오지 않는다
}
function slotGap(a,b,cap){const d=Math.abs(a-b)%cap;return Math.min(d,cap-d)}
/* 슬롯 시작 각도(도) — 궤도마다 시작 위치를 흔들고, 그 안에서 슬롯을 균등 분할한다 */
function homeAngle(s){return (homeRand('ring'+s.ring)*360+s.slot*360/HOME_RING_CAPS[s.ring])%360}

function renderHome(){
  const g=S.homeOrbit, act=activeCompanies(), list=visibleCompanies();
  if(co(S.profile.company))placeHomePlanet(S.profile.company);   // 내 행성이 가장 안쪽 궤도를 먼저 차지한다
  list.forEach(c=>placeHomePlanet(c.id));
  const maxR=(($('space')&&$('space').clientWidth)||320)/2-HOME_PAD;

  let h='';
  Array.from(new Set(list.map(c=>g.slots[c.id].ring))).sort().forEach(r=>{
    const d=(HOME_RING_FRACS[r]*maxR*2).toFixed(1);
    // 이번에 처음 합류한 행성만 올라온 궤도라면 궤도도 같이 등장한다
    const fresh=list.filter(c=>g.slots[c.id].ring===r).every(c=>g.entering.has(c.id));
    h+='<div class="orbit'+(fresh?' new':'')+'" style="width:'+d+'px;height:'+d+'px"></div>';
  });
  h+='<div id="sun">한화</div>';
  list.forEach(c=>{
    const s=g.slots[c.id], r=(HOME_RING_FRACS[s.ring]*maxR).toFixed(1);
    const lit=act.has(c.id), mine=c.id===S.profile.company;
    const n=Object.keys(S.met).filter(p=>PEOPLE[p]&&PEOPLE[p].co===c.id).length;
    h+='<div class="holder" style="--a:'+homeAngle(s).toFixed(1)+'deg;--d:'+HOME_RING_SECS[s.ring]+'s">'
      +'<button class="planet '+(lit?'lit':'dim')+(mine?' mine':'')+(g.entering.has(c.id)?' new':'')+'"'
      +' style="--c:'+c.c+';left:'+r+'px;top:0"'
      +' onclick="showCo(&quot;'+c.id+'&quot;)" data-co="'+c.id+'"'
      +' aria-label="'+esc(c.name)+(mine?' · 내 계열사':'')+(n?' · 아는 사람 '+n+'명':'')+'">'
      +'<span class="dot" aria-hidden="true">'+(COMPANIES.indexOf(c)+1)+'</span></button></div>';
  });
  $('space').innerHTML=h;
  g.entering.clear();

  const met=Object.keys(S.met).length, rest=COMPANIES.length-list.length;
  // 다음 할 일 — 프로필 → 참가 → AI 장소 추천. 세 단계가 모두 끝나면 카드는 사라진다
  const P=S.profile, steps=[
    {ok:P.interests.length+P.hobbies.length>0, t:'관심사·취미 설정', d:'취향이 맞는 동료를 찾아봐요', go:'profile', cta:'프로필 설정하기'},
    {ok:S.joined.length>0, t:'어울리는 모임 참가', d:'매칭 탭에서 골라요', go:'match', cta:'모임 찾기'},
    {ok:!!S.placeRecommendationTried, t:'AI 장소 추천 기능 써보기', d:'채팅방에서 후보와 추천 이유를 살펴봐요', go:'chat', cta:'장소 추천 써보기'},
  ];
  const next=steps.find(s=>!s.ok);
  $('nextcard').innerHTML=next
    ?'<div class="card next"><div class="nh"><b>다음 할 일</b></div>'
      +'<p class="next-action">'+next.t+'</p>'
      +'<button class="cta sm" onclick="'+(next.go==='chat'?'tryPlaceRecommendations()':'go(\''+next.go+'\')')+'">'+next.cta+'</button>'
      +'<details class="next-steps"><summary>전체 단계 · '+steps.filter(s=>s.ok).length+' / 3 완료</summary>'
      +steps.map(s=>'<div class="ns'+(s.ok?' ok':s===next?' cur':'')+'"><span class="ck">'+(s.ok?ico('check'):'')+'</span><div><b>'+s.t+(s.ok?' · 완료':'')+'</b><small>'+s.d+'</small></div></div>').join('')
      +'</details></div>'
    :'';
  $('homehint').innerHTML=met
    ?(rest
      ?'<b style="color:var(--orange-soft)">아는 사람이 생긴 계열사</b>가 이 은하계에 합류합니다 · 아직 '+rest+'곳이 우주 밖에 있어요'
      :'모든 계열사에 아는 사람이 생겼어요 · 빛나는 행성 = 만남이 성사된 계열사')
    :'매칭 탭에서 만남이 성사되면 <b style="color:var(--orange-soft)">그 계열사가 이 은하계에 합류</b>합니다';
  $('spacestats').innerHTML=
    '<div class="card"><b>'+act.size+'<small style="font-size:12px;color:var(--tx3)"> / '+COMPANIES.length+'</small></b><span>빛나는 행성</span></div>'
   +'<div class="card"><b>'+met+'명</b><span>연결된 동료</span></div>'
   +'<div class="card"><b>'+S.joined.length+'개</b><span>참여 중인 모임</span></div>';
  $('cocount').textContent=act.size+' / '+COMPANIES.length+'곳 활성';
  $('homeAv').textContent=S.profile.av;
  // 계열사 목록 — 활성(아는 사람 있음)·내 계열사를 먼저, 나머지는 접어 둔다.
  // 전 계열사 행을 항상 그려 두고 CSS 로만 숨겨, 펼치기 전에도 목록 구조는 같다
  const top=c=>act.has(c.id)||c.id===S.profile.company;
  const sorted=[...COMPANIES].sort((a,b)=>(top(a)?0:1)-(top(b)?0:1));
  const hidden=sorted.filter(c=>!top(c)).length;
  $('colist').innerHTML=sorted.map(c=>{
    const lit=act.has(c.id);
    const n=Object.keys(S.met).filter(p=>PEOPLE[p]&&PEOPLE[p].co===c.id).length;
    return '<button class="corow'+(!top(c)&&!S.ui.coAll?' hid':'')+'" style="width:100%;text-align:left" onclick="showCo(&quot;'+c.id+'&quot;)" data-co="'+c.id+'">'
      +'<span class="pd" style="--c:'+c.c+'" aria-hidden="true">'+(top(c)?COMPANIES.indexOf(c)+1:'')+'</span>'
      +'<span class="nm">'+esc(c.name)+(c.id===S.profile.company?' <small style="color:var(--orange);font-size:10.5px">MY</small>':'')+'</span>'
      +'<span class="st '+(lit?'lit':'')+'">'+(lit?'커넥션 활성 · '+n+'명':'미개척')+'</span>'+ico('chev','chev')+'</button>';
  }).join('')
  +(hidden?'<button class="cotg'+(S.ui.coAll?' open':'')+'" onclick="S.ui.coAll=!S.ui.coAll;renderHome()">'+(S.ui.coAll?'접기':'아직 우주 밖인 '+hidden+'곳 보기')+ico('chev','chev')+'</button>':'');
}

/* 로그아웃 등으로 사용자가 바뀌면 은하계를 처음 상태로 되돌린다
   (앞 사용자의 계열사 배치가 남지 않도록) */
function resetHomeOrbit(){
  const g=S.homeOrbit;
  g.seed=Math.floor(Math.random()*1e9);
  g.slots={};
  g.entering.clear();
}

function showCo(id){
  const c=co(id), lit=activeCompanies().has(id);
  const ppl=Object.keys(S.met).filter(p=>PEOPLE[p]&&PEOPLE[p].co===id).map(p=>PEOPLE[p]);
  const mine=id===S.profile.company;
  $('cosheet').innerHTML='<div class="grip"></div>'
    +'<div class="sh"><div style="display:flex;align-items:center;gap:12px;min-width:0">'
    +'<span style="width:30px;height:30px;border-radius:50%;flex-shrink:0;background:'+(lit?c.c:'#2A3050')+';box-shadow:'+(lit?'0 0 16px '+c.c:'none')+'"></span>'
    +'<div style="min-width:0"><b style="font-size:18px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(c.name)+'</b>'
    +'<div style="font-size:12px;font-weight:600;color:'+(lit?'var(--orange-soft)':'var(--tx3)')+'">'+(lit?'커넥션 활성화 · 아는 사람 '+ppl.length+'명':'아직 만남이 없는 계열사')+'</div></div></div>'
    +'<button class="ib" onclick="hideCo()" aria-label="닫기">'+ico('x')+'</button></div>'
    +(ppl.length
      ?'<div style="font-size:13.5px;color:var(--tx2);line-height:1.6;margin:10px 0 16px">이곳에서 만난 동료 — '+ppl.map(p=>'<b style="color:var(--tx)">'+esc(p.real)+'</b>').join(', ')+'</div>'
      :'<div style="font-size:13.5px;color:var(--tx2);line-height:1.6;margin:10px 0 16px">매칭 탭에서 이 계열사 동료가 있는 모임에 참가하면 이 행성이 은하계에 합류하고 빛나기 시작해요.</div>')
    +(mine
      ?'<button class="cta" onclick="hideCo();openSat()">내 행성 보기 — 위성이 된 동료들</button>'
      :'<button class="cta line" onclick="hideCo();go(\'match\')">매칭 탭에서 모임 찾기</button>');
  $('cowrap').classList.add('on');
}
function hideCo(){$('cowrap').classList.remove('on')}

/* 내 행성(위성) 뷰 */
function openSat(){
  $('satTitle').textContent='내 행성 · '+myCo().name;
  const mates=Object.keys(S.met).filter(p=>PEOPLE[p]&&PEOPLE[p].co===S.profile.company);
  let h='<div class="orbit" style="width:190px;height:190px"></div><div class="orbit" style="width:266px;height:266px"></div>'
       +'<div id="meCore">'+esc(S.profile.av)+'<span>나</span></div>';
  mates.forEach((pid,i)=>{
    const r=i%2?133:95, d=26+i*7, a=(i*137.5)%360;   // 황금각으로 시작 위치를 벌리고, 위성마다 속도를 달리한다
    h+='<div class="holder" style="--a:'+a.toFixed(1)+'deg;--d:'+d+'s">'
      +'<div class="sat" style="left:'+r+'px;top:0"><div class="av">'+esc(PEOPLE[pid].av)+'</div><div class="nm">'+esc(PEOPLE[pid].real)+'</div></div></div>';
  });
  $('mespace').innerHTML=h;
  $('satlist').innerHTML=mates.length
    ?mates.map(pid=>{const p=PEOPLE[pid];return '<div class="corow"><span style="font-size:20px">'+esc(p.av)+'</span><span class="nm">'+esc(p.real)+'</span><span class="st lit">연결됨</span></div>'}).join('')
    :'<div class="empty" style="padding:18px 0"><i>🛰️</i><b>아직 위성이 없어요</b>같은 계열사 동료와 만남을 완료하면<br>여기서 곁을 돌기 시작해요</div>';
  $('satview').classList.add('on');
}
function closeSat(){$('satview').classList.remove('on')}
