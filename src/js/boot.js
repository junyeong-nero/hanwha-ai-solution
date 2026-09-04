/* ================= 시작 ================= */
bindChipEvents();
if(BACKEND)initBackend();
else{renderHome();renderProfile();updateBdg();}
