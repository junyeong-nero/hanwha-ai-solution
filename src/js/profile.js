/* ================= 프로필 ================= */
/* 설정 변경은 로컬 상태만 바꾸고 "저장" 버튼으로 반영한다 */
function setP(k,v){S.profile[k]=v;renderProfile();profileChanged()}
function cycleAvatar(){const i=AVATARS.indexOf(S.profile.av);S.profile.av=AVATARS[(i+1)%AVATARS.length];renderProfile();profileChanged()}
function bumpAge(d){S.profile.age=Math.min(45,Math.max(20,S.profile.age+d));renderProfile();profileChanged()}
function bumpSize(k,d){
  const P=S.profile;
  if(k==='min')P.sizeMin=Math.min(P.sizeMax,Math.max(2,P.sizeMin+d));
  else P.sizeMax=Math.max(P.sizeMin,Math.min(10,P.sizeMax+d));
  renderProfile();profileChanged();
}
function toggleSame(){S.profile.sameGender=!S.profile.sameGender;renderProfile();profileChanged()}
function tgl(arr,v){const i=arr.indexOf(v);i<0?arr.push(v):arr.splice(i,1);renderProfile();profileChanged()}
function tglRegion(r){
  const P=S.profile, i=P.regions.indexOf(r);
  if(i<0)P.regions.push(r); else if(P.regions.length>1)P.regions.splice(i,1); else {toast('선호 지역','최소 한 곳은 선택해야 해요');return}
  renderProfile();profileChanged();
}
function renderSaveBtn(){
  const b=$('saveBtn'); b.disabled=!S.dirty; b.classList.toggle('dirty',S.dirty);
  b.textContent=S.dirty?'저장 · 변경 사항 있음':'저장됨';
}
async function saveProfileNow(){
  if(!S.dirty)return;
  const b=$('saveBtn'); b.disabled=true; b.textContent='저장 중…';
  if(BACKEND){ const ok=await saveProfile(true); if(!ok){renderSaveBtn();return} }
  S.dirty=false; R.recDirty=true; renderSaveBtn();
  toast('저장 완료','바뀐 설정이 다음 매칭 추천에 반영돼요');
}
function renderProfile(){
  const P=S.profile;
  $('pfav').textContent=P.av;
  if(document.activeElement!==$('nick'))$('nick').value=P.nick;
  $('pfident').textContent=P.realName?P.realName+' · '+(co(P.company)||{}).name+' (로그인 정보)':'';
  $('f-co').innerHTML=COMPANIES.map(c=>'<option value="'+c.id+'"'+(c.id===P.company?' selected':'')+'>'+c.name+'</option>').join('');
  $('f-co').disabled=!!(BACKEND&&ME);   // 백엔드 모드에서는 계열사가 로그인 정보로 고정된다
  $('f-region').innerHTML=REGIONS.map(r=>chipHtml('region',r,P.regions.includes(r))).join('')
    +'<button class="chip add" onclick="openAdd(\'region\')">＋ 직접 추가</button>';
  $('f-age').textContent=P.age+'세';
  $('f-gender').innerHTML=[['m','남성'],['f','여성'],[null,'선택 안 함']].map(([v,l])=>
    '<button class="'+(P.gender===v?'on':'')+'" onclick="setP(\'gender\','+(v?'\''+v+'\'':'null')+')">'+l+'</button>').join('');
  const MB=['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'];
  $('f-mbti').innerHTML=MB.map(m=>'<option'+(m===P.mbti?' selected':'')+'>'+m+'</option>').join('');
  $('f-int').innerHTML=INTS.map(v=>chipHtml('int',v,P.interests.includes(v))).join('')
    +'<button class="chip add" onclick="openAdd(\'int\')">＋ 직접 추가</button>';
  $('f-hob').innerHTML=HOBS.map(v=>chipHtml('hob',v,P.hobbies.includes(v))).join('')
    +'<button class="chip add" onclick="openAdd(\'hob\')">＋ 직접 추가</button>';
  $('f-min').textContent=P.sizeMin+'명';$('f-max').textContent=P.sizeMax+'명';
  $('f-same').classList.toggle('on',P.sameGender);
  $('samehint').textContent=P.gender?'같은 성별 멤버가 많은 모임을 먼저 추천해요':'성별을 설정하면 적용돼요 · 같은 성별 멤버가 많은 모임을 먼저 추천';
  renderSaveBtn();
  $('f-scope').innerHTML=[['mine','내 계열사 위주'],['all','다른 계열사와도']].map(([v,l])=>
    '<button class="'+(P.scope===v?'on':'')+'" onclick="setP(\'scope\',\''+v+'\')">'+l+'</button>').join('');
  $('f-dir').innerHTML=[['deep','깊은 유대 — 만난 사람과 또'],['wide','넓은 인맥 — 새로운 만남']].map(([v,l])=>
    '<button class="'+(P.dir===v?'on':'')+'" onclick="setP(\'dir\',\''+v+'\')">'+l+'</button>').join('');
}
$('nick').addEventListener('input',e=>{S.profile.nick=e.target.value||'달토끼';profileChanged()});

/* 칩 렌더링: 직접 추가한 항목은 × 삭제 버튼이 붙는다 */
function chipHtml(kind,v,on){
  const chip=`<button class="chip${on?' on':''}" data-kind="${esc(kind)}" data-v="${esc(v)}">${esc(v)}</button>`;
  if(BASE[kind].includes(v))return chip;
  return `<span class="chipwrap">${chip}<button class="chipx" data-chip-remove data-kind="${esc(kind)}" data-v="${esc(v)}" aria-label="${esc(v)} 삭제">×</button></span>`;
}
function removeItem(kind,v){
  const P=S.profile;
  if(kind==='region'){REGIONS=REGIONS.filter(x=>x!==v); P.regions=P.regions.filter(x=>x!==v); if(!P.regions.length)P.regions=[BASE.region[0]];}
  else if(kind==='int'){INTS=INTS.filter(x=>x!==v); P.interests=P.interests.filter(x=>x!==v);}
  else{HOBS=HOBS.filter(x=>x!==v); P.hobbies=P.hobbies.filter(x=>x!==v);}
  renderProfile();profileChanged();
  toast('삭제 완료','<b>'+esc(v)+'</b> 항목을 지웠어요');
}

/* 칩은 사용자 입력을 인라인 JS로 만들지 않고 data-*와 이벤트 위임으로 처리한다 */
function bindChipEvents(){
  document.addEventListener('click',e=>{
    const remove=e.target.closest('[data-chip-remove]');
    if(remove){ removeItem(remove.dataset.kind,remove.dataset.v); return; }
    const profileChip=e.target.closest('[data-kind][data-v]');
    if(profileChip){
      const {kind,v}=profileChip.dataset;
      if(kind==='region')tglRegion(v);
      else if(kind==='int')tgl(S.profile.interests,v);
      else if(kind==='hob')tgl(S.profile.hobbies,v);
      return;
    }
    const createChip=e.target.closest('[data-create-kind][data-v]');
    if(createChip){
      if(createChip.dataset.createKind==='region')cset('region',createChip.dataset.v);
      else if(createChip.dataset.createKind==='tag')ctag(createChip.dataset.v);
    }
  });
}

/* 직접 추가 */
let ADDKIND=null;
const ADDMETA={
  region:{t:'선호 지역 직접 추가'},
  int:{t:'관심사 직접 추가'},
  hob:{t:'취미 직접 추가'},
};
function openAdd(kind){
  ADDKIND=kind;
  $('addtitle').textContent=ADDMETA[kind].t;
  $('addin').value='';
  $('addwrap').classList.add('on');
  setTimeout(()=>$('addin').focus(),100);
}
function hideAdd(){$('addwrap').classList.remove('on')}
function confirmAdd(){
  let v=$('addin').value.trim();
  if(!v)return;
  if(ADDKIND==='region'){
    if(!REGIONS.includes(v))REGIONS.push(v);
    if(!S.profile.regions.includes(v))S.profile.regions.push(v);
  }else if(ADDKIND==='int'){
    if(!INTS.includes(v))INTS.push(v);
    if(!S.profile.interests.includes(v))S.profile.interests.push(v);
  }else{
    if(!HOBS.includes(v))HOBS.push(v);
    if(!S.profile.hobbies.includes(v))S.profile.hobbies.push(v);
  }
  hideAdd();renderProfile();profileChanged();
  toast('추가 완료','<b>'+esc(v)+'</b> 항목이 선택됐어요 · 매칭에 반영돼요');
}

