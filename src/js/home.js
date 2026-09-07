/* ================= 홈: 점진 탐색형 계열사 관계 그래프 =================
   처음에는 주요 계열사(HOME_CORE_IDS)만 띄우고, 행성을 탐색할 때마다
   COMPANY_LINKS 로 이어진 계열사가 바깥 궤도에 단계적으로 추가된다.
   배치는 시드 기반 결정적 랜덤 + 간단한 충돌 회피라 재렌더링해도 위치가 흔들리지 않는다. */
const HOME_RING_CAPS=[6,11,16];         // 안쪽 궤도부터 담을 수 있는 행성 수 (합 33 ≥ 전체 계열사 수)
const HOME_RING_FRACS=[.37,.66,.95];    // 궤도 반지름 비율 (바깥 궤도 = 1) — 궤도 간격도 최소 간격 이상
const HOME_PAD=26;                      // 44px 터치 타겟이 잘리지 않도록 남기는 가장자리 여백(px)
const HOME_BASE_R=320/2-HOME_PAD;       // 320px 기준 바깥 궤도 반지름(px) — 충돌 계산 기준
const HOME_MIN_GAP=40;                  // 320px 기준 행성 사이 최소 간격(px)
const HOME_REVEAL_STEP=2;               // 한 번 탐색할 때 새로 열리는 계열사 수

function activeCompanies(){
  const set=new Set();
  Object.keys(S.met).forEach(pid=>{const p=PEOPLE[pid];if(p)set.add(p.co)});
  return set;
}

/* 시드 해시 — 같은 (세션 시드, key)면 언제나 같은 0~1 값이 나온다 */
function homeRand(key){
  let h=(S.homeGraph.seed^0x9e3779b9)>>>0;
  const s=String(key);
  for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193)>>>0;
  h=Math.imul(h^(h>>>15),0x2545f491)>>>0;
  return ((h^(h>>>16))>>>0)/4294967296;
}

/* COMPANY_LINKS 를 양방향 인접 목록으로 펼쳐 둔다 (한 번만 만들고 재사용) */
let HOME_ADJ=null;
function companyAdjacency(){
  if(HOME_ADJ)return HOME_ADJ;
  HOME_ADJ={};
  const has=id=>COMPANIES.some(c=>c.id===id);
  const add=(a,b)=>{if(a===b||!has(a)||!has(b))return;(HOME_ADJ[a]=HOME_ADJ[a]||new Set()).add(b)};
  Object.keys(COMPANY_LINKS).forEach(a=>COMPANY_LINKS[a].forEach(b=>{add(a,b);add(b,a)}));
  return HOME_ADJ;
}
function linkedCompanies(id){return Array.from(companyAdjacency()[id]||[])}
function hiddenLinkCount(id){return linkedCompanies(id).filter(o=>!S.homeGraph.shown.has(o)).length}
function linkKey(a,b){return a<b?a+'|'+b:b+'|'+a}

/* 지금 보여줄 계열사 — 열린 계열사 + 내 계열사 + 점등된 계열사(만남이 성사된 곳은 항상 보인다) */
function visibleCompanies(){
  const g=S.homeGraph;
  if(S.profile.company)g.shown.add(S.profile.company);
  activeCompanies().forEach(id=>g.shown.add(id));
  return COMPANIES.filter(c=>g.shown.has(c.id));
}

/* 관계 탐색 — 아직 열리지 않은 인접 계열사를 최대 HOME_REVEAL_STEP 개까지 연다 */
function expandHomeCompany(id){
  const g=S.homeGraph;
  const added=linkedCompanies(id)
    .filter(o=>!g.shown.has(o))
    .sort((a,b)=>homeRand(id+'>'+a)-homeRand(id+'>'+b))
    .slice(0,HOME_REVEAL_STEP);
  added.forEach(o=>{g.shown.add(o);g.origin[o]=id;g.entering.add(o)});
  added.forEach(o=>linkedCompanies(o).forEach(n=>{
    if(g.shown.has(n))g.enteringLinks.add(linkKey(o,n));
  }));
  return added;
}

/* 궤도 슬롯 배치 — 부모 계열사와 가까운 바깥 궤도를 먼저 노리고, 겹치면 다른 슬롯으로 피한다.
   한 번 정한 좌표는 S.homeGraph.slots 에 남아 세션 내내 그대로 다시 쓰인다. */
function placeHomeNode(id){
  const g=S.homeGraph;
  if(g.slots[id])return g.slots[id];
  const placed=Object.keys(g.slots).map(k=>g.slots[k]);
  const taken=new Set(placed.map(p=>p.ring+':'+p.slot));
  const parent=g.slots[g.origin[id]];
  const from=parent?Math.min(HOME_RING_CAPS.length-1,parent.ring+1):0;
  const cands=[];
  for(let d=0;d<HOME_RING_CAPS.length;d++){
    const ring=(from+d)%HOME_RING_CAPS.length, cap=HOME_RING_CAPS[ring];
    const step=2*Math.PI/cap, base=homeRand('ring'+ring)*2*Math.PI;   // 궤도마다 시작 각도를 흔들어 규칙성을 없앤다
    for(let slot=0;slot<cap;slot++){
      if(taken.has(ring+':'+slot))continue;
      const ang=base+slot*step+(homeRand(id+':a'+ring+slot)-.5)*step*.24;   // 슬롯 폭 안에서만 흔들린다
      const rf=HOME_RING_FRACS[ring]+(homeRand(id+':r'+ring+slot)-.5)*.04;
      const near=parent?angleGap(ang,parent.ang)/Math.PI:0;                 // 부모와 가까운 슬롯이 우선
      cands.push({ring,slot,ang,rf,rank:d+near});
    }
  }
  cands.sort((a,b)=>a.rank-b.rank);
  let best=cands[0], bestGap=-1;
  for(const c of cands){
    const gap=nodeGap(c,placed);
    if(gap>=HOME_MIN_GAP){best=c;break}     // 충돌 회피 — 최소 간격을 만족하는 첫 후보를 쓴다
    if(gap>bestGap){bestGap=gap;best=c}     // 자리가 빡빡하면 그중 가장 널널한 후보로
  }
  g.slots[id]=best;
  return best;
}
function angleGap(a,b){const d=Math.abs(a-b)%(2*Math.PI);return d>Math.PI?2*Math.PI-d:d}
function nodePx(s){return {x:s.rf*HOME_BASE_R*Math.cos(s.ang),y:s.rf*HOME_BASE_R*Math.sin(s.ang)}}
function nodeGap(s,placed){
  const a=nodePx(s);
  return placed.reduce((min,p)=>{const b=nodePx(p);return Math.min(min,Math.hypot(a.x-b.x,a.y-b.y))},Infinity);
}

function renderHome(){
  const g=S.homeGraph, act=activeCompanies(), list=visibleCompanies();
  list.forEach(c=>placeHomeNode(c.id));
  const w=($('space')&&$('space').clientWidth)||320;
  const maxPct=50-HOME_PAD/w*100;        // 어떤 폭에서도 가장자리에 26px 을 남겨 행성이 잘리지 않는다
  const pos={};
  list.forEach(c=>{const s=g.slots[c.id];
    pos[c.id]={x:50+s.rf*maxPct*Math.cos(s.ang),y:50+s.rf*maxPct*Math.sin(s.ang)};
  });

  let h='';
  Array.from(new Set(list.map(c=>g.slots[c.id].ring))).sort().forEach(r=>{
    const d=(HOME_RING_FRACS[r]*maxPct*2).toFixed(2);
    // 이번에 처음 열린 행성만 올라온 궤도라면 궤도도 같이 등장한다
    const fresh=list.filter(c=>g.slots[c.id].ring===r).every(c=>g.entering.has(c.id));
    h+='<div class="orbit'+(fresh?' new':'')+'" style="width:'+d+'%;height:'+d+'%"></div>';
  });
  const seen=new Set();
  h+='<svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">';
  list.forEach(c=>linkedCompanies(c.id).forEach(o=>{
    if(!pos[o])return;
    const key=linkKey(c.id,o);
    if(seen.has(key))return;
    seen.add(key);
    h+='<line class="link'+(act.has(c.id)&&act.has(o)?' lit':'')+(g.enteringLinks.has(key)?' new':'')+'"'
      +' x1="'+pos[c.id].x.toFixed(2)+'" y1="'+pos[c.id].y.toFixed(2)+'"'
      +' x2="'+pos[o].x.toFixed(2)+'" y2="'+pos[o].y.toFixed(2)+'"></line>';
  }));
  h+='</svg><div id="sun">한화</div>';
  list.forEach(c=>{
    const lit=act.has(c.id), mine=c.id===S.profile.company, more=hiddenLinkCount(c.id);
    h+='<button class="planet '+(lit?'lit':'dim')+(mine?' mine':'')+(g.entering.has(c.id)?' new':'')+'"'
      +' style="--c:'+c.c+';--s:'+(mine?'19px':'15px')+';left:'+pos[c.id].x.toFixed(2)+'%;top:'+pos[c.id].y.toFixed(2)+'%"'
      +' onclick="tapCo(&quot;'+c.id+'&quot;)"'
      +' aria-label="'+esc(c.name)+(more?' · 이어진 계열사 '+more+'곳 더 보기':'')+'">'
      +'<span class="dot"></span>'+(more?'<span class="more"></span>':'')+'</button>';
  });
  $('space').innerHTML=h;
  g.entering.clear();
  g.enteringLinks.clear();

  const met=Object.keys(S.met).length, rest=COMPANIES.length-list.length;
  $('homehint').innerHTML=rest
    ?'행성을 누르면 <b style="color:var(--orange-soft)">관계가 있는 계열사</b>가 열립니다 · 아직 '+rest+'곳이 우주 밖에 있어요'
    :'모든 계열사를 탐색했어요 · 빛나는 행성 = 만남이 성사된 계열사';
  $('spacestats').innerHTML=
    '<div class="card"><b>'+act.size+'<small style="font-size:12px;color:var(--tx3)"> / '+COMPANIES.length+'</small></b><span>빛나는 행성</span></div>'
   +'<div class="card"><b>'+met+'명</b><span>연결된 동료</span></div>'
   +'<div class="card"><b>'+S.joined.length+'개</b><span>참여 중인 모임</span></div>';
  $('colist').innerHTML=list.map(c=>{
    const lit=act.has(c.id);
    const n=Object.keys(S.met).filter(p=>PEOPLE[p]&&PEOPLE[p].co===c.id).length;
    return '<button class="corow" style="width:100%;text-align:left" onclick="tapCo(&quot;'+c.id+'&quot;)">'
      +'<span class="pd" style="background:'+(lit?c.c:'#2A3050')+';box-shadow:'+(lit?'0 0 8px '+c.c:'none')+'"></span>'
      +'<span class="nm">'+esc(c.name)+(c.id===S.profile.company?' <small style="color:var(--orange);font-size:10.5px">MY</small>':'')+'</span>'
      +'<span class="st '+(lit?'lit':'')+'">'+(lit?'커넥션 활성 · '+n+'명':'미개척')+'</span></button>';
  }).join('')
   +(rest?'<div class="corow" style="justify-content:center"><span class="st">탐색할수록 계열사가 늘어납니다 · '+list.length+' / '+COMPANIES.length+'</span></div>':'');
}

/* 행성·목록 탭 — 관계를 한 단계 넓히고 상세 시트를 연다 */
function tapCo(id){
  if(expandHomeCompany(id).length)renderHome();
  showCo(id);
}
/* 상세 시트의 "이어진 계열사 더 보기" — 다음 단계를 마저 연다 */
function exploreCo(id){
  if(expandHomeCompany(id).length){renderHome();showCo(id)}
}

function showCo(id){
  const c=co(id), lit=activeCompanies().has(id);
  const ppl=Object.keys(S.met).filter(p=>PEOPLE[p]&&PEOPLE[p].co===id).map(p=>PEOPLE[p]);
  const mine=id===S.profile.company;
  const near=linkedCompanies(id).filter(o=>S.homeGraph.shown.has(o)).map(o=>co(o)).filter(Boolean);
  const more=hiddenLinkCount(id);
  $('cosheet').innerHTML='<div class="grip"></div>'
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
    +'<span style="width:26px;height:26px;border-radius:50%;background:'+(lit?c.c:'#2A3050')+';box-shadow:'+(lit?'0 0 14px '+c.c:'none')+'"></span>'
    +'<div><b style="font-size:17px">'+esc(c.name)+'</b>'
    +'<div style="font-size:12px;color:'+(lit?'var(--orange-soft)':'var(--tx3)')+'">'+(lit?'커넥션 활성화':'아직 만남이 없는 계열사')+'</div></div></div>'
    +(ppl.length
      ?'<div style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:14px">이곳에서 만난 동료 — '+ppl.map(p=>'<b style="color:var(--tx)">'+esc(p.real)+'</b>').join(', ')+'</div>'
      :'<div style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:14px">매칭 탭에서 이 계열사 동료가 있는 모임에 참가하면 이 행성이 빛나기 시작해요.</div>')
    +(near.length
      ?'<div style="font-size:12.5px;color:var(--tx3);line-height:1.6;margin-bottom:14px">이어진 계열사 — '+near.map(o=>esc(o.name)).join(' · ')+'</div>'
      :'')
    +(more?'<button class="cta line" style="margin-bottom:9px" onclick="exploreCo(&quot;'+id+'&quot;)">이어진 계열사 더 보기 ('+more+'곳)</button>':'')
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
    const r=i%2?133:95, d=26+i*7, del=-(d*i*.31);
    h+='<div class="holder" style="--d:'+d+'s;--del:'+del+'s">'
      +'<div class="sat" style="left:'+r+'px;top:0"><div class="av">'+esc(PEOPLE[pid].av)+'</div><div class="nm">'+esc(PEOPLE[pid].real)+'</div></div></div>';
  });
  $('mespace').innerHTML=h;
  $('satlist').innerHTML=mates.length
    ?mates.map(pid=>{const p=PEOPLE[pid];return '<div class="corow"><span style="font-size:20px">'+esc(p.av)+'</span><span class="nm">'+esc(p.real)+'</span><span class="st lit">연결됨</span></div>'}).join('')
    :'<div class="empty" style="padding:22px 0">아직 같은 계열사에서 만난 동료가 없어요</div>';
  $('satview').classList.add('on');
}
function closeSat(){$('satview').classList.remove('on')}
