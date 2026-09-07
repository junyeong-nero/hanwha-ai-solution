/* 장소 추천은 채팅의 대화 소재다. 후보 강조는 개인 화면에만, 의견은 편집 가능한 초안에 담는다. */
function placeRecommendationHtml(msg,previous){
  const p=msg.plan||{},cands=p.cands||[];
  const mode=msg.source==='demo'||!BACKEND?'데모 예시':msg.source==='fallback'?'검색 기반 후보':'대화 기반 추천';
  const intro=!BACKEND?'실제 검색이 아닌 가상 장소로 기능을 체험해 보세요.':msg.source==='fallback'
    ?'대화 분석을 마치지 못해 검색 결과를 모았어요. 주소와 업종을 비교해 보세요.'
    :'최근 대화의 취향과 지역을 참고했어요. 마음에 드는 곳을 함께 이야기해 보세요.';
  const body='<p class="place-intro">'+intro+'</p>'
    +(!previous?planMapHtml(msg.planId,cands):'')
    +'<div class="place-candidates">'+candListHtml(msg.planId,cands,true)+'</div>'
    +searchNoteHtml(msg.search)
    +(cands.length?'<p class="place-footnote">'+(BACKEND?'영업시간·예약 가능 여부는 장소 상세에서 확인해 주세요.':'데모 후보에는 실제 주소·지도 링크가 없어요.')+'</p>':'<p class="place-intro">아직 추천할 장소를 찾지 못했어요. 채팅에 원하는 지역이나 음식을 남겨 주세요.</p>');
  return '<div class="msg aimsg places-msg" id="rec-'+esc(msg.planId)+'"><div class="mav" aria-hidden="true">'+ico('spark')+'</div><div class="place-content"><div class="who">MoonLight AI <small>'+esc(msg.t||'')+'</small></div>'
    +'<div class="bub plan place-plan"><div class="place-heading"><span class="badge or">'+mode+'</span><span>'+cands.length+'곳</span></div>'
    +(previous?'<details class="previous-places"><summary>이전 장소 후보 보기</summary>'+body+'</details>':'<h4>이런 곳은 어때요?</h4>'+body)
    +'</div></div></div>';
}
function placeRequestStatusHtml(r){
  if(r.planPending)return '<div class="place-status" role="status" aria-live="polite"><span class="sk"></span><b>대화에 어울리는 장소를 찾고 있어요</b><p>추천을 기다리면서 채팅을 계속해도 괜찮아요.</p></div>';
  if(r.planError)return '<div class="place-status" role="alert"><b>장소를 불러오지 못했어요</b><p>'+esc(r.planError)+'</p><button class="cta line sm" onclick="aiPlan()">다시 추천받기</button></div>';
  return '';
}
function draftPlaceOpinion(planId,index){
  const candidate=planCands(planId)[index];if(!candidate)return;
  const input=$('cin');
  // 작성 중인 메시지는 보존한다. 전송은 사용자가 입력창에서 직접 한다.
  if(input.value.trim()){toast('작성 중인 메시지가 있어요','먼저 보내거나 비운 뒤 다시 눌러 주세요');input.focus();return}
  const url=safeUrl(candidate.url);
  input.value=(candidate.name+'에서 만나면 어떨까요?'+(url!=='#'?' '+url:'')).slice(0,500);
  updateCount();input.focus();
  toast('의견 초안','메시지를 확인하고 보내 주세요');
}
function tryPlaceRecommendations(){
  go('chat');
  const id=S.joined.find(id=>S.rooms[id]);
  if(id)openRoom(id);
}
