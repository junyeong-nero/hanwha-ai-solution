/* ================= 홈: 태양계 ================= */
function activeCompanies(){
  const set=new Set();
  Object.keys(S.met).forEach(pid=>set.add(PEOPLE[pid].co));
  return set;
}
function renderHome(){
  const act=activeCompanies();
  let h='<div id="sun">한화</div>';
  const rings=Math.ceil(Math.sqrt(COMPANIES.length));
  const maxR=Math.max(80,Math.min(188,(($('space').clientWidth||320)/2)-22));
  COMPANIES.forEach((c,i)=>{
    const ring=Math.floor(i/rings);
    const r=Math.max(44,maxR*(ring+1)/rings), d=34+ring*9, del=-(d*((i%rings)/rings));
    h+='<div class="orbit" style="width:'+(r*2)+'px;height:'+(r*2)+'px"></div>';
    const lit=act.has(c.id), mine=c.id===S.profile.company;
    h+='<div class="holder" style="--d:'+d+'s;--del:'+del+'s">'
      +'<button class="planet '+(lit?'lit':'dim')+(mine?' mine':'')+'" style="--c:'+c.c+';--s:'+(mine?'19px':'15px')+';left:'+r+'px;top:0" '
      +'onclick="showCo(\''+c.id+'\')" aria-label="'+c.name+'"><span class="dot"></span></button></div>';
  });
  $('space').innerHTML=h;
  const met=Object.keys(S.met).length;
  $('spacestats').innerHTML=
    '<div class="card"><b>'+act.size+'<small style="font-size:12px;color:var(--tx3)"> / '+COMPANIES.length+'</small></b><span>빛나는 행성</span></div>'
   +'<div class="card"><b>'+met+'명</b><span>연결된 동료</span></div>'
   +'<div class="card"><b>'+S.joined.length+'개</b><span>참여 중인 모임</span></div>';
  $('colist').innerHTML=COMPANIES.map(c=>{
    const lit=activeCompanies().has(c.id);
    const n=Object.keys(S.met).filter(p=>PEOPLE[p].co===c.id).length;
    return '<button class="corow" style="width:100%;text-align:left" onclick="showCo(\''+c.id+'\')">'
      +'<span class="pd" style="background:'+(lit?c.c:'#2A3050')+';box-shadow:'+(lit?'0 0 8px '+c.c:'none')+'"></span>'
      +'<span class="nm">'+c.name+(c.id===S.profile.company?' <small style="color:var(--orange);font-size:10.5px">MY</small>':'')+'</span>'
      +'<span class="st '+(lit?'lit':'')+'">'+(lit?'커넥션 활성 · '+n+'명':'미개척')+'</span></button>';
  }).join('');
}
function showCo(id){
  const c=co(id), lit=activeCompanies().has(id);
  const ppl=Object.keys(S.met).filter(p=>PEOPLE[p].co===id).map(p=>PEOPLE[p]);
  const mine=id===S.profile.company;
  $('cosheet').innerHTML='<div class="grip"></div>'
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
    +'<span style="width:26px;height:26px;border-radius:50%;background:'+(lit?c.c:'#2A3050')+';box-shadow:'+(lit?'0 0 14px '+c.c:'none')+'"></span>'
    +'<div><b style="font-size:17px">'+c.name+'</b>'
    +'<div style="font-size:12px;color:'+(lit?'var(--orange-soft)':'var(--tx3)')+'">'+(lit?'커넥션 활성화':'아직 만남이 없는 계열사')+'</div></div></div>'
    +(ppl.length
      ?'<div style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:14px">이곳에서 만난 동료 — '+ppl.map(p=>'<b style="color:var(--tx)">'+p.real+'</b>').join(', ')+'</div>'
      :'<div style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:14px">매칭 탭에서 이 계열사 동료가 있는 모임에 참가하면 이 행성이 빛나기 시작해요.</div>')
    +(mine
      ?'<button class="cta" onclick="hideCo();openSat()">내 행성 보기 — 위성이 된 동료들</button>'
      :'<button class="cta line" onclick="hideCo();go(\'match\')">매칭 탭에서 모임 찾기</button>');
  $('cowrap').classList.add('on');
}
function hideCo(){$('cowrap').classList.remove('on')}

/* 내 행성(위성) 뷰 */
function openSat(){
  $('satTitle').textContent='내 행성 · '+myCo().name;
  const mates=Object.keys(S.met).filter(p=>PEOPLE[p].co===S.profile.company);
  let h='<div class="orbit" style="width:190px;height:190px"></div><div class="orbit" style="width:266px;height:266px"></div>'
       +'<div id="meCore">'+S.profile.av+'<span>나</span></div>';
  mates.forEach((pid,i)=>{
    const r=i%2?133:95, d=26+i*7, del=-(d*i*.31);
    h+='<div class="holder" style="--d:'+d+'s;--del:'+del+'s">'
      +'<div class="sat" style="left:'+r+'px;top:0"><div class="av">'+PEOPLE[pid].av+'</div><div class="nm">'+PEOPLE[pid].real+'</div></div></div>';
  });
  $('mespace').innerHTML=h;
  $('satlist').innerHTML=mates.length
    ?mates.map(pid=>{const p=PEOPLE[pid];return '<div class="corow"><span style="font-size:20px">'+p.av+'</span><span class="nm">'+p.real+'</span><span class="st lit">연결됨</span></div>'}).join('')
    :'<div class="empty" style="padding:22px 0">아직 같은 계열사에서 만난 동료가 없어요</div>';
  $('satview').classList.add('on');
}
function closeSat(){$('satview').classList.remove('on')}

