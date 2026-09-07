/* ================= 후보 장소 지도 (카카오맵) =================
   공개 JS 키(CONFIG.KAKAO_JS_KEY)가 있으면 카카오맵 SDK를 동적으로 불러 실제 지도를 그리고,
   없으면(로컬 데모 · file://) 좌표를 상대 위치로 환산한 지도 placeholder를 그린다.
   두 경우 모두 후보 목록 카드와 지도 Marker의 선택 상태가 양방향으로 이어진다.
   서버 전용 REST 키는 브라우저에 두지 않는다 — 실제 장소 검색은 Edge Function이 한다. */

const KMAP={
  sdk:null,                 // SDK 로드 Promise (한 번만 만든다)
  failed:false,             // SDK 로드 실패 — 이후로는 placeholder만 그린다
  views:{},                 // planId -> {node, map, markers, cands}
};
const PLACE_SEL={};         // planId -> 선택한 후보 index
const KAKAO_SDK_TIMEOUT=8000;
const PIN_PAD=12;           // placeholder 지도에서 가장자리에 붙지 않도록 두는 여백(%)
const PIN_BOTTOM=34;        // 아래쪽은 선택한 후보를 적는 설명 띠가 차지한다(%)

const mapKey=()=>String((typeof CONFIG!=='undefined'&&CONFIG.KAKAO_JS_KEY)||'');
const mapsEnabled=()=>!!mapKey()&&!KMAP.failed;
/* 좌표가 있는 후보만 지도에 올릴 수 있다 */
const hasCoord=c=>!!c&&typeof c.lat==='number'&&typeof c.lng==='number';
const mappable=cands=>(cands||[]).filter(hasCoord);
const selIdx=planId=>PLACE_SEL[planId]||0;

/* 카카오맵 SDK 로드 — 실패·지연은 placeholder로 넘어간다 (지도가 약속 카드를 막지 않는다) */
function loadKakaoMaps(){
  if(KMAP.sdk)return KMAP.sdk;
  KMAP.sdk=new Promise((res,rej)=>{
    if(window.kakao&&window.kakao.maps&&window.kakao.maps.Map)return res(window.kakao.maps);
    const s=document.createElement('script');
    s.src='https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey='+encodeURIComponent(mapKey());
    const timer=setTimeout(()=>rej(new Error('KAKAO_MAP_TIMEOUT')),KAKAO_SDK_TIMEOUT);
    s.onload=()=>{
      // 도메인이 등록되지 않았거나 키가 잘못되면 kakao.maps가 없다
      if(!window.kakao||!window.kakao.maps){clearTimeout(timer);return rej(new Error('KAKAO_MAP_KEY'))}
      window.kakao.maps.load(()=>{clearTimeout(timer);res(window.kakao.maps)});
    };
    s.onerror=()=>{clearTimeout(timer);rej(new Error('KAKAO_MAP_SCRIPT'))};
    document.head.appendChild(s);
  }).catch(e=>{KMAP.failed=true;throw e});
  return KMAP.sdk;
}

/* ===== placeholder 지도 배치 (순수 계산 — 테스트 대상) =====
   좌표가 있는 후보들을 감싸는 사각형을 화면 비율(%)로 환산한다.
   가로세로 같은 배율을 써서 실제 거리감을 지키고, 한 점만 있거나 좌표가 모두 같으면 가운데에 둔다. */
function pinLayout(cands){
  const pts=[];
  (cands||[]).forEach((c,i)=>{ if(hasCoord(c))pts.push({i,lat:c.lat,lng:c.lng}) });
  if(!pts.length)return [];
  const lats=pts.map(p=>p.lat), lngs=pts.map(p=>p.lng);
  const minLat=Math.min(...lats), minLng=Math.min(...lngs);
  const spanLat=Math.max(...lats)-minLat, spanLng=Math.max(...lngs)-minLng;
  const span=Math.max(spanLat,spanLng);
  const availX=100-PIN_PAD*2, availY=100-PIN_PAD-PIN_BOTTOM;   // 아래쪽은 설명 띠 자리를 비운다
  const scale=Math.min(availX,availY);
  const left=PIN_PAD+(availX-scale)/2, top=PIN_PAD+(availY-scale)/2;
  return pts.map(p=>({
    i:p.i,
    x:span>0?left+((p.lng-minLng)+(span-spanLng)/2)/span*scale:left+scale/2,
    // 위도는 위로 갈수록 커지므로 y 는 뒤집는다
    y:span>0?top+scale-((p.lat-minLat)+(span-spanLat)/2)/span*scale:top+scale/2,
  }));
}

/* ===== 마크업 ===== */

/* 후보 목록 카드 — 누르면 지도 Marker와 선택 상태가 함께 바뀐다 */
function candListHtml(planId,cands,disabled){
  return (cands||[]).map((c,i)=>{
    const on=i===selIdx(planId), url=safeUrl(c.url);
    return '<div class="cand'+(on?' on':'')+'" id="cand-'+esc(planId)+'-'+i+'">'
      +'<details class="cand-reason"><summary class="press" aria-label="'+esc(c.name||'장소')+' 추천 이유">'+ico('info')+'</summary>'
      +'<div class="cand-reason-panel"><strong>추천 이유</strong>'+esc(c.why||'모임 지역에서 검색한 후보예요. 주소와 업종을 비교해 보세요.')+'</div></details>'
      +'<button class="pick" aria-pressed="'+(on?'true':'false')+'" onclick="selectCand(\''+esc(planId)+'\','+i+')">'
      +'<span class="no">'+(i+1)+'</span>'
      +'<span class="txt"><b>'+esc(c.name||'')+'</b>'
      +(c.category?'<span class="cat">'+esc(c.category)+'</span>':'')
      +(c.verified===false?'<span class="cat warn">검색 미확인</span>':'')
      +(c.ambiguous?'<span class="cat warn">같은 이름 여러 곳</span>':'')
      +(c.address?'<small>'+esc(c.address)+'</small>':'')
      +'</span></button>'
      +'<div class="cand-actions"><button class="opinion press" onclick="draftPlaceOpinion(\''+esc(planId)+'\','+i+')">이곳 어때요?</button>'
      +(url!=='#'?'<a class="detail" href="'+esc(url)+'" target="_blank" rel="noopener" aria-label="'+esc(c.name||'')+' 상세 보기">상세 ↗</a>':'')
      +'</div></div>';
  }).join('');
}

/* 검색 상태별 토스트 문구 */
const SEARCH_TOAST={
  empty:'검색 결과가 없어 대체 검색어를 안내했어요',
  quota:'장소 검색 할당량을 초과했어요 · 잠시 후 다시 시도해 주세요',
  auth:'장소 검색에 연결하지 못했어요 · 잠시 후 다시 시도해 주세요',
  error:'장소 검색에 실패했어요 · 다시 시도해 주세요',
  no_key:'장소 검색을 사용할 수 없어요 · 잠시 후 다시 시도해 주세요',
};

/* 검색 상태 안내 — 결과 없음 · 할당량 초과 · 오류를 구분해 보여 준다 */
function searchNoteHtml(search){
  if(!search)return '';
  const alt=(search.alternatives||[]).slice(0,2).map(q=>esc(q)).join(' · ');
  const msg={
    empty:'검색 결과가 없어요'+(alt?' · 이렇게 찾아 보세요: '+alt:' · 다른 지역이나 키워드로 다시 시도해 주세요'),
    quota:'장소 검색 할당량을 초과했어요 · 잠시 후 다시 시도해 주세요',
    auth:'장소 검색에 연결하지 못했어요 · 잠시 후 다시 시도해 주세요',
    error:'장소 검색에 실패했어요 · 다시 시도해 주세요',
    no_key:'장소 검색을 사용할 수 없어요 · 잠시 후 다시 시도해 주세요',
  }[search.status];
  return msg?'<p class="cnote">'+msg+'</p>':'';
}

/* 지도 영역 — SDK를 쓸 수 있으면 빈 컨테이너(마운트 후 채움), 아니면 placeholder */
function planMapHtml(planId,cands){
  const pins=mappable(cands);
  if(!pins.length)return '';
  if(mapsEnabled())return '<div class="planmap" id="pm-'+esc(planId)+'" data-planmap="'+esc(planId)+'"></div>';
  return '<div class="planmap ph" id="pm-'+esc(planId)+'">'+mapPhHtml(planId,cands)+'</div>';
}

/* 데모·SDK 미사용 시의 고정 지도 placeholder */
function mapPhHtml(planId,cands){
  const sel=selIdx(planId);
  const pins=pinLayout(cands).map(p=>{
    const c=cands[p.i];
    return '<button class="pin'+(p.i===sel?' on':'')+'" style="left:'+p.x.toFixed(1)+'%;top:'+p.y.toFixed(1)+'%" '
      +'aria-pressed="'+(p.i===sel?'true':'false')+'" aria-label="'+esc(c.name||'')+'" '
      +'onclick="selectCand(\''+esc(planId)+'\','+p.i+')"><i>'+(p.i+1)+'</i></button>';
  }).join('');
  const cur=cands[sel]||{};
  return '<div class="grid" aria-hidden="true"></div>'+pins
    +'<div class="cap">상대 위치 · 후보 '+mappable(cands).length+'곳 · <b>'+esc(cur.name||'')+'</b></div>';
}

/* ===== 실제 지도 마운트 ===== */

/* renderMsgs로 DOM이 새로 그려진 뒤 호출한다. 이미 만든 지도는 새 컨테이너로 옮겨 재사용한다. */
function mountPlanMaps(){
  if(!mapsEnabled())return;
  document.querySelectorAll('[data-planmap]').forEach(box=>{
    const planId=box.getAttribute('data-planmap');
    const cands=planCands(planId);
    if(!mappable(cands).length)return;
    const view=KMAP.views[planId];
    if(view&&view.node){
      if(view.node.parentNode!==box){box.innerHTML='';box.appendChild(view.node);if(view.map)view.map.relayout()}
      syncMarkers(planId);
      return;
    }
    const node=document.createElement('div');
    node.className='kmap';
    box.innerHTML=''; box.appendChild(node);
    KMAP.views[planId]={node,map:null,markers:[],cands};
    loadKakaoMaps().then(maps=>drawMap(maps,planId,cands)).catch(()=>{
      // 키·도메인·네트워크 문제 — 지도는 placeholder로 내려앉고 목록은 그대로 쓸 수 있다
      delete KMAP.views[planId];
      document.querySelectorAll('[data-planmap]').forEach(el=>{
        el.classList.add('ph'); el.innerHTML=mapPhHtml(el.getAttribute('data-planmap'),planCands(el.getAttribute('data-planmap')));
      });
    });
  });
}

function drawMap(maps,planId,cands){
  const view=KMAP.views[planId]; if(!view||!view.node.isConnected)return;
  const pins=mappable(cands);
  const first=pins[selIdx(planId)]||pins[0];
  const map=new maps.Map(view.node,{center:new maps.LatLng(first.lat,first.lng),level:5});
  const bounds=new maps.LatLngBounds();
  view.map=map; view.markers=[];
  cands.forEach((c,i)=>{
    if(!hasCoord(c))return;
    const pos=new maps.LatLng(c.lat,c.lng);
    bounds.extend(pos);
    const marker=new maps.Marker({map,position:pos,title:c.name||''});
    maps.event.addListener(marker,'click',()=>selectCand(planId,i));
    view.markers.push({i,marker,pos});
  });
  if(view.markers.length>1)map.setBounds(bounds);
  syncMarkers(planId);
}

/* 선택된 후보의 Marker를 앞으로 끌어올리고 지도 중심을 옮긴다 */
function syncMarkers(planId,recenter){
  const view=KMAP.views[planId]; if(!view||!view.map)return;
  const sel=selIdx(planId);
  view.markers.forEach(m=>{
    m.marker.setZIndex(m.i===sel?10:1);
    if(m.marker.setOpacity)m.marker.setOpacity(m.i===sel?1:0.65);
  });
  const hit=view.markers.find(m=>m.i===sel);
  if(hit&&recenter)view.map.panTo(hit.pos);
}

/* ===== 선택 (목록 ↔ 지도 양방향) ===== */

/* 지금 화면에 떠 있는 약속 카드의 후보 목록 */
function planCands(planId){
  const r=S.rooms[CUR]; if(!r)return [];
  const msg=r.msgs.find(m=>m.f==='ai'&&m.planId===planId);
  return (msg&&msg.plan&&msg.plan.cands)||[];
}

function selectCand(planId,i){
  const cands=planCands(planId); if(!cands[i])return;
  PLACE_SEL[planId]=i;
  // 목록 카드 강조
  cands.forEach((_,k)=>{
    const el=$('cand-'+planId+'-'+k); if(!el)return;
    el.classList.toggle('on',k===i);
    const btn=el.querySelector('.pick'); if(btn)btn.setAttribute('aria-pressed',k===i?'true':'false');
    if(k===i&&el.scrollIntoView)el.scrollIntoView({block:'nearest'});
  });
  // 지도 강조
  const box=$('pm-'+planId);
  if(box&&box.classList.contains('ph'))box.innerHTML=mapPhHtml(planId,cands);
  else syncMarkers(planId,true);
}

/* 로그아웃 등으로 사용자 상태를 비울 때 — 선택과 지도 인스턴스를 함께 버린다 */
function resetPlanMaps(){
  Object.keys(PLACE_SEL).forEach(k=>delete PLACE_SEL[k]);
  Object.keys(KMAP.views).forEach(k=>delete KMAP.views[k]);
}

/* 이전 호출은 장소를 확정하지 않고 의견 초안만 만든다. */
function pickPlace(planId){draftPlaceOpinion(planId,selIdx(planId))}
