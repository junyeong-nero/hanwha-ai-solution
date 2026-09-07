/* ================= 시작 ================= */
bindChipEvents();
if(BACKEND)initBackend();
else{restoreAvailabilityRooms();renderHome();renderProfile();updateBdg();}
