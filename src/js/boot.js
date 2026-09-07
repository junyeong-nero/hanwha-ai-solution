/* ================= 시작 ================= */
bindChipEvents();
if(BACKEND)initBackend();
else{renderHome();renderProfile();updateBdg();}

/* 다른 곳을 누르거나 Escape를 누르면 추천 이유를 닫는다. */
document.addEventListener('click',event=>{
  document.querySelectorAll('.cand-reason[open]').forEach(detail=>{
    if(!detail.contains(event.target))detail.open=false;
  });
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  document.querySelectorAll('.cand-reason[open]').forEach(detail=>{
    detail.open=false;detail.querySelector('summary').focus();
  });
});
