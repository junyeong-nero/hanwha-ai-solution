/* 개인 추천 패널. 질문을 고르면 초안만 채우고 실제 전송은 사용자가 한다. */
function openSmallTalk(){
  hidePlus();const r=S.rooms[CUR];if(!r)return;
  r.talkVisible=true;renderMsgs();$('talk-topic').focus();
}
function smallTalkHtml(r){
  if(!r.talkVisible)return '';
  const result=r.talkResult;
  const label=!BACKEND?'데모 예시 · 웹 검색 없음':result?.fallback?'기본 질문 · 웹 검색 결과를 가져오지 못했어요':'최근 대화와 웹 검색으로 주제를 찾아요';
  return '<section class="talk-panel card" aria-label="AI 스몰토크"><div class="talk-heading"><b>'+ico('spark')+' AI 스몰토크</b><button class="ib" onclick="S.rooms[CUR].talkVisible=false;renderMsgs()" aria-label="스몰토크 닫기">'+ico('x')+'</button></div>'
    +'<p class="hint">나에게만 보여요. 질문을 골라 대화를 시작해 보세요.</p>'
    +'<label for="talk-topic">원하는 주제 <small>(선택)</small></label><input id="talk-topic" maxlength="80" placeholder="예: 운동, 주말에 볼 영화" value="'+esc(r.talkTopic||'')+'" oninput="S.rooms[CUR].talkTopic=this.value">'
    +'<p class="hint">최근 대화 일부가 익명 처리되어 외부 AI에 전송돼요. 웹 검색에는 일반 주제만 사용해요.</p>'
    +'<button class="cta soft sm" onclick="aiSmallTalk()" '+(r.talkPending?'disabled':'')+'>'+(r.talkPending?'대화 주제를 찾고 있어요…':result?'다시 추천받기':'대화 주제 추천받기')+'</button>'
    +'<p class="hint" role="status">'+esc(label)+(result?.searched_at?' · 검색 '+esc(new Date(result.searched_at).toLocaleDateString('ko-KR')):'')+'</p>'
    +(r.talkError?'<p class="hint" role="alert">'+esc(r.talkError)+' · 위 버튼으로 다시 시도해 주세요.</p>':'')
    +(result?.topics||[]).map((t,i)=>'<article class="talk-topic"><b>'+esc(t.title)+'</b><p>'+esc(t.question)+'</p><p class="hint">'+esc(t.reason)+'</p>'
      +(t.source&&safeUrl(t.source.url)!=='#'?'<a class="talk-source" href="'+esc(safeUrl(t.source.url))+'" target="_blank" rel="noopener noreferrer">출처 · '+esc(t.source.title)+'</a>':'')
      +'<button class="cta line sm" onclick="draftSmallTalk('+i+')">이 질문으로 대화하기</button></article>').join('')+'</section>';
}
async function aiSmallTalk(){
  const id=CUR,r=S.rooms[id],epoch=backendEpoch;if(!r||r.talkPending)return;
  r.talkPending=true;r.talkError='';renderMsgs();
  try{
    let result;
    if(BACKEND)result=await callFn('suggest-small-talk',{meeting_id:id,topic:r.talkTopic||''});
    else{
      const topic=(r.talkTopic||MEETINGS.find(m=>m.id===id)?.tags?.[0]||'취미').slice(0,80);
      const questions=r.talkRound%2?['처음 시작하는 사람에게 어떤 팁을 주고 싶으세요?','함께 도전해보고 싶은 활동이 있어요?','쉬는 날 꼭 챙기는 작은 즐거움이 뭐예요?']
        :[topic+'에 관심 갖게 된 계기가 있어요?','최근에 즐긴 음식이나 콘텐츠 중 하나만 추천해 주실래요?','이번 주말에 해보고 싶은 일이 있어요?'];
      result={topics:questions.map((question,i)=>({title:['취향 알아가기','서로 추천하기','다음 이야기'][i],question,reason:'실제 검색 없이 제공하는 대화 질문 예시예요.',source:null})),fallback:false,searched_at:null};
    }
    if(epoch!==backendEpoch||S.rooms[id]!==r)return;
    if(!Array.isArray(result?.topics)||!result.topics.length)throw Error('추천 결과가 비어 있어요');
    r.talkResult=result;r.talkRound=(r.talkRound||0)+1;
  }catch(e){if(epoch===backendEpoch&&S.rooms[id]===r)r.talkError=e.message||'연결을 확인해 주세요'}
  finally{r.talkPending=false;if(epoch===backendEpoch&&CUR===id&&S.rooms[id]===r)renderMsgs()}
}
function draftSmallTalk(index){
  const topic=S.rooms[CUR]?.talkResult?.topics[index];if(!topic)return;
  const input=$('cin');
  if(input.value.trim()){toast('작성 중인 메시지가 있어요','먼저 보내거나 비운 뒤 다시 눌러 주세요');input.focus();return}
  input.value=String(topic.question).slice(0,500);updateCount();input.focus();
  toast('대화 초안','질문을 확인하고 보내 주세요');
}
