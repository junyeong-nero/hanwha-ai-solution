/* ================= 별 배경 ================= */
(function(){let h='';for(let i=0;i<70;i++){const s=Math.random()<.8?1.4:2.2;
  h+='<span class="star" style="left:'+(Math.random()*100)+'%;top:'+(Math.random()*100)+'%;width:'+s+'px;height:'+s+'px;animation-delay:'+(Math.random()*3)+'s"></span>'}
  $('stars').innerHTML=h})();

/* ================= 확인 시트 — 브라우저 confirm 대신 앱 톤의 바텀 시트 ================= */
let CF=null;
function askConfirm(title,desc,okLabel,danger){
  return new Promise(res=>{
    CF=res; $('cf-title').textContent=title; $('cf-desc').textContent=desc||'';
    const ok=$('cf-ok'); ok.textContent=okLabel||'확인'; ok.classList.toggle('danger',!!danger);
    $('confirmwrap').classList.add('on');
  });
}
function answerConfirm(v){ $('confirmwrap').classList.remove('on'); const f=CF; CF=null; if(f)f(!!v) }

/* ================= 탭 전환 ================= */
function go(t){
  // 채팅방·사진첩·내 행성 화면이 열려 있어도 탭을 누르면 닫고 이동한다
  if(CUR)closeRoom();
  $('album').classList.remove('on'); $('satview').classList.remove('on');
  S.tab=t;
  $('fab').classList.toggle('on',t==='match');   // 모임 만들기 플로팅 버튼은 매칭 탭에서만
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.toggle('on',p.id==='tab-'+t));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  if(t==='home'){renderHome(); if(BACKEND&&ME)loadConnections().then(renderHome);}
  if(t==='match')renderMatch();
  if(t==='chat'){renderRooms(); if(BACKEND&&ME)loadRooms().then(renderRooms);}
}

