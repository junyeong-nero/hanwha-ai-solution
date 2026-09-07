/* ================= 시작 ================= */
bindChipEvents();
if(BACKEND)initBackend();
else{restoreAvailabilityRooms();restorePollRooms();renderHome();renderProfile();updateBdg();}
if(!BACKEND)openPollLink();
