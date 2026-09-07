/* ================= 백엔드 설정 (이중 모드) =================
   GitHub Pages 배포 시 Supabase 프로젝트 URL과 publishable(anon) 키만 채운다.
   비어 있으면 아래 하드코딩 데이터만으로 동작하는 로컬 데모 모드가 된다 (네트워크 요청 없음).
   secret key·OpenRouter 키는 절대 여기 넣지 않는다 — Edge Function 비밀값에만 둔다.

   KAKAO_JS_KEY 는 카카오맵 JavaScript 키(공개용)다. 지도를 그리는 데만 쓰이고,
   카카오 개발자 콘솔에서 배포 도메인(github.io · 로컬)을 등록해 다른 사이트에서는 동작하지 않게 막는다.
   장소 검색에 쓰는 REST 키는 서버 전용이라 여기 넣지 않는다 — Edge Function 비밀값(KAKAO_REST_KEY)에만 둔다.
   비어 있으면 지도는 좌표 기반 placeholder 로 대체되고 후보 비교·선택은 그대로 동작한다. */
const CONFIG={SUPABASE_URL:'https://vcmlqiovovflrkkjbzlt.supabase.co',SUPABASE_ANON_KEY:'sb_publishable_1ngvGKkMYVVlODiu_aWH3A_72Wq58Pn',KAKAO_JS_KEY:'5106296a5746d9ba4c3a1347acbf1eb2',DEMO_MODE:true};
/* ?demo=1 로 열면 백엔드 설정이 있어도 로컬 데모 모드로 돈다 — 발표장 네트워크 장애 대비 · 디자인 확인용 */
const LOCAL_DEMO=typeof location!=='undefined'&&/[?&]demo=1(&|$)/.test(location.search);
const BACKEND=!!(CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_ANON_KEY)&&!LOCAL_DEMO;

/* ================= 데이터 (로컬 데모 모드 · 백엔드 모드에서는 서버 데이터로 대체됨) ================= */
const COMPANIES=[
  {id:'aero', name:'한화에어로스페이스', c:'#8B5CF6'},
  {id:'sol',  name:'한화솔루션',        c:'#17A67C'},
  {id:'life', name:'한화생명',          c:'#E8B84B'},
  {id:'inv',  name:'한화투자증권',      c:'#F37321'},
  {id:'sys',  name:'한화시스템',        c:'#5A9CF3'},
  {id:'ocean',name:'한화오션',          c:'#2BB3C0'},
  {id:'hotel',name:'한화호텔앤드리조트',c:'#E86A8A'},
  {id:'gal',  name:'한화갤러리아',      c:'#B49BE0'},
  {id:'corp', name:'㈜한화',           c:'#D6A84F'},
  {id:'vision', name:'한화비전',       c:'#7C83FD'},
  {id:'semitech', name:'한화세미텍',    c:'#4CC9F0'},
  {id:'momentum', name:'한화모멘텀',    c:'#F72585'},
  {id:'robotics', name:'한화로보틱스',  c:'#A855F7'},
  {id:'energy', name:'한화에너지',     c:'#22C55E'},
  {id:'impact', name:'한화임팩트',     c:'#F59E0B'},
  {id:'power', name:'한화파워',        c:'#EF4444'},
  {id:'total', name:'한화토탈에너지스', c:'#14B8A6'},
  {id:'engine', name:'한화엔진',       c:'#64748B'},
  {id:'advanced', name:'한화첨단소재', c:'#06B6D4'},
  {id:'yeocheon', name:'여천NCC',      c:'#84CC16'},
  {id:'ins', name:'한화손해보험',      c:'#FB7185'},
  {id:'asset', name:'한화자산운용',    c:'#C084FC'},
  {id:'savings', name:'한화저축은행',  c:'#38BDF8'},
  {id:'life-fs', name:'한화생명금융서비스', c:'#E879F9'},
  {id:'connect', name:'한화커넥트',    c:'#F43F5E'},
];
const PEOPLE={
  p1:{real:'오세림', nick:'달빛서기',   co:'inv',  av:'🐰', ints:['위스키','전시']},
  p2:{real:'이하늘', nick:'은하수달',   co:'sol',  av:'🦊', ints:['러닝','캠핑']},
  p3:{real:'김서연', nick:'보름달곰',   co:'life', av:'🐻', ints:['자동화','사진']},
  p4:{real:'박지훈', nick:'고요한혜성', co:'sys',  av:'🐺', ints:['러닝','보드게임']},
  p5:{real:'정우진', nick:'새벽위성',   co:'aero', av:'🦉', ints:['러닝','커피']},
  p6:{real:'최민아', nick:'달무리여우', co:'gal',  av:'🐱', ints:['위스키','사진']},
  p7:{real:'한지원', nick:'초승달항해사',co:'ocean',av:'🐧', ints:['맛집','등산']},
  p8:{real:'강도윤', nick:'월광산책자', co:'hotel',av:'🐹', ints:['위스키','맛집']},
  p9:{real:'윤소이', nick:'별헤는밤',   co:'life', av:'🦌', ints:['자동화','산책']},
  p10:{real:'서준호',nick:'만월기사',   co:'inv',  av:'🐯', ints:['자동화','주식']},
};
const MEETINGS=[
  {id:'m7', em:'🌿', name:'인재경영원 교육 후 저녁 산책', region:'인재경영원', when:'평일 저녁', cap:300,
   tags:['산책','러닝'], members:['p9','p10'],
   ai:'교육 기간에 <b>인재경영원</b>에서 만나기 좋은 모임이에요. 저녁 산책은 처음 만나는 사이에도 부담이 없어요.'},
];
/* 로컬 데모용 mock 장소 후보. 실서비스에서는 서버(Edge Function)가 카카오 장소 검색으로 같은 모양을 채운다
   — 장소 ID · 이름 · 주소 · 좌표 · 분류 · 상세 링크. 좌표가 있어야 지도에서 후보를 비교할 수 있다. */
const mapUrl=q=>'https://map.kakao.com/?q='+encodeURIComponent(q);
let PC_SEQ=0;
const pc=(name,address,category,lat,lng,why,q)=>({id:'demo-'+(++PC_SEQ),name,address,category,lat,lng,url:mapUrl(q||name),why,verified:true});
const PLAN_CANDS={
  m1:[pc('판교 화랑공원','경기 성남시 분당구 삼평동','공원',37.4028,127.1015,'트랙이 평탄하고 퇴근 후 모이기 쉬워요'),
      pc('판교 중앙공원','경기 성남시 분당구 백현동','공원',37.3894,127.1096,'3km 코스가 딱 맞아요'),
      pc('탄천 산책로 판교 구간','경기 성남시 분당구','산책로',37.3999,127.1108,'조명이 있어 저녁에도 안전해요','탄천 산책로 판교')],
  m2:[pc('판교 하이볼 바 달','경기 성남시 분당구 판교역로','바',37.3947,127.1112,'위스키 종류가 많고 조용해요','판교 하이볼'),
      pc('판교 어탕국수','경기 성남시 분당구 삼평동','한식',37.4023,127.0985,'안주 겸 저녁으로 좋아요')],
  m3:[pc('여의도 한화 라운지','서울 영등포구 여의도동','모임 공간',37.5199,126.9403,'노트북 쓰기 좋은 회의 공간','여의도 63빌딩'),
      pc('여의도 커피 브루잉랩','서울 영등포구 여의나루로','카페',37.5215,126.9245,'점심 후 30분 정리하기 좋아요','여의도 카페')],
  m4:[pc('청진옥','서울 종로구 종로3길','한식',37.5705,126.9789,'장교동에서 도보 10분, 국밥 원조'),
      pc('을지로 오래된 다방','서울 중구 을지로','카페',37.5661,126.9910,'후식 커피 한 잔','을지로 다방')],
  m5:[pc('판교 보드게임 카페','경기 성남시 분당구 판교역로','카페',37.3950,127.1105,'초심자용 게임이 많아요','판교 보드게임카페'),
      pc('판교 떡볶이 연구소','경기 성남시 분당구','분식',37.3965,127.1085,'게임 전 간단히 먹기 좋아요','판교 떡볶이')],
  m6:[pc('서울숲 정문','서울 성동구 뚝섬로','공원',37.5444,127.0374,'필름 카메라 산책 시작점','서울숲'),
      pc('성수 베이글','서울 성동구 성수동','카페',37.5445,127.0557,'산책 후 브런치')],
  m7:[pc('인재경영원 산책로','경기 용인시 처인구','산책로',37.2312,127.2075,'교육 후 바로 모일 수 있어요','한화 인재경영원'),
      pc('용인 호수공원','경기 용인시','공원',37.2400,127.1780,'차로 10분, 저녁 산책 코스')],
};
const REPLIES=[
  '좋아요, 저도 그 생각 했어요 😄','오 시간 괜찮으신가요 다들?','저는 목요일이 제일 좋아요!',
  '다들 어느 사옥에서 오세요?','ㅋㅋㅋ 기대되네요','저 처음이라 조금 떨리네요 😅','날짜 정해지면 바로 캘린더에 넣을게요!',
];

/* ================= 상태 ================= */
const S={
  tab:'home',
  profile:{
    nick:'달토끼', av:'🌙', company:'inv', regions:['인재경영원'], age:27, gender:null, mbti:'ENFP',
    interests:['러닝','자동화'], hobbies:['위스키','사진'], sizeMin:4, sizeMax:6,
    sameGender:false, scope:'all', dir:'wide',
  },
  dirty:false,                           // 프로필 변경 후 저장 전 상태
  met:{p1:true,p2:true},                 // 한 번 이상 만난 사람
  feedback:{},                           // 로컬 데모용 만남 평가 (meeting id -> {rating, comment})
  joined:[],                             // 참가한 모임 id
  placeRecommendationTried:false,         // 후보를 실제로 받아 본 뒤 홈 가이드를 완료한다
  rooms:{},                              // id -> {msgs, unread, planned, photos, votes, attended, iAttended}
  ui:{coAll:false},                      // 화면 상태 — 홈 계열사 목록 펼침 여부
  homeOrbit:{                            // 홈 은하계 — 아는 사람이 생긴 계열사가 궤도를 돌며 합류한다
    seed:Math.floor(Math.random()*1e9),  // 세션 단위 시드 — 궤도 시작 각도와 슬롯 선택에 쓴다
    slots:{},                            // 계열사 -> {ring, slot} 궤도 자리 (한 번 정하면 고정)
    entering:new Set(),                  // 이번 렌더에서 등장 애니메이션을 줄 행성
  },
};
const AVATARS=['🌙','🌕','⭐','☄️','🪐','🌌'];
let REGIONS=['판교','여의도','장교','인재경영원','대전','창원','서울숲'];
let INTS=['러닝','자동화','주식','전시','야구','캠핑'];
let HOBS=['위스키','사진','보드게임','커피','등산','요리'];
const BASE={region:[...REGIONS],int:[...INTS],hob:[...HOBS]};   // 기본 항목 — 이 밖의 값은 직접 추가한 것이라 삭제 가능
const WHENS=['평일 점심','평일 저녁','금요일 저녁','주말 오전','주말 오후','시간 미정'];
const EMOJIS=['🌙','🏃','🍜','☕','🎲','📷','📚','🥃','🎬','⚽'];
const co=id=>COMPANIES.find(c=>c.id===id);
const myCo=()=>co(S.profile.company);
/* 마지막으로 저장한 프로필 스냅샷 — 매칭 탭은 저장된 값만 쓴다.
   서버 추천도 저장된 프로필로 돌아가므로, 저장 전 변경이 화면에만 먼저 반영돼 결과와 어긋나는 일을 막는다 */
const PSAVED={v:null};
function snapProfile(){PSAVED.v=JSON.parse(JSON.stringify(S.profile))}
const savedProfile=()=>PSAVED.v||S.profile;
snapProfile();
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));   // null·숫자도 안전
const safeUrl=u=>/^https?:\/\//i.test(String(u||''))?String(u):'#';   // 후보지 링크는 http(s)만 (javascript: 차단)
/* 인라인 SVG 아이콘 — 정보용 이모지 대신 쓰는 UI 아이콘 (currentColor 를 따라간다) */
const ICON={
  pin:'<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  users:'<circle cx="9" cy="8" r="3.4"/><path d="M2.8 19c.7-3.2 3.2-4.9 6.2-4.9s5.5 1.7 6.2 4.9"/><circle cx="17" cy="9" r="2.6"/><path d="M16.2 14.3c2.6.2 4.5 1.7 5.1 4.7"/>',
  chev:'<path d="M9 6l6 6-6 6"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  spark:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  cal:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
const ico=(n,cls)=>'<span class="ic'+(cls?' '+cls:'')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(ICON[n]||'')+'</svg></span>';
/* 날짜 키(YYYY-MM-DD)와 채팅 날짜 구분선 라벨 */
const dayKey=d=>{const x=d?new Date(d):new Date();if(isNaN(x))return '';return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
function dateLabel(dk){const t=dayKey(),y=dayKey(new Date(Date.now()-864e5));if(dk===t)return '오늘';if(dk===y)return '어제';const p=dk.split('-');return Number(p[1])+'월 '+Number(p[2])+'일'}
/* 빈 방의 첫 인사 추천 — 누르면 그대로 보낸다 */
const OPENERS=['안녕하세요! 반가워요 👋','다들 어느 사옥에서 근무하세요?','언제가 편하세요? 저는 평일 저녁이 좋아요','처음이라 조금 떨리네요 😅 잘 부탁드려요'];
function nowT(){const d=new Date(),h=d.getHours();return (h<12?'오전 ':'오후 ')+((h%12)||12)+':'+String(d.getMinutes()).padStart(2,'0')}
function toast(a,b){$('toast').innerHTML='<div><b>'+a+'</b> · '+b+'</div>';$('toast').classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>$('toast').classList.remove('on'),2600)}

