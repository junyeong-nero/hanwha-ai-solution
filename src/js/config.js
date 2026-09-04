/* ================= 백엔드 설정 (이중 모드) =================
   GitHub Pages 배포 시 Supabase 프로젝트 URL과 publishable(anon) 키만 채운다.
   비어 있으면 아래 하드코딩 데이터만으로 동작하는 로컬 데모 모드가 된다 (네트워크 요청 없음).
   secret key·OpenRouter 키는 절대 여기 넣지 않는다 — Edge Function 비밀값에만 둔다. */
const CONFIG={SUPABASE_URL:'https://nxqukthjluwoaqehpxtl.supabase.co',SUPABASE_ANON_KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54cXVrdGhqbHV3b2FxZWhweHRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MjM3MjEsImV4cCI6MjEwMzk5OTcyMX0.2SZc2BZSGmN9VpM66MZs2UwkKmGzEHeGQLfQ3K7fmCg',DEMO_MODE:true};
const BACKEND=!!(CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_ANON_KEY);

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
  p1:{real:'오세림', nick:'달빛서기',   co:'inv',  av:'🐰'},
  p2:{real:'이하늘', nick:'은하수달',   co:'sol',  av:'🦊'},
  p3:{real:'김서연', nick:'보름달곰',   co:'life', av:'🐻'},
  p4:{real:'박지훈', nick:'고요한혜성', co:'sys',  av:'🐺'},
  p5:{real:'정우진', nick:'새벽위성',   co:'aero', av:'🦉'},
  p6:{real:'최민아', nick:'달무리여우', co:'gal',  av:'🐱'},
  p7:{real:'한지원', nick:'초승달항해사',co:'ocean',av:'🐧'},
  p8:{real:'강도윤', nick:'월광산책자', co:'hotel',av:'🐹'},
  p9:{real:'윤소이', nick:'별헤는밤',   co:'life', av:'🦌'},
  p10:{real:'서준호',nick:'만월기사',   co:'inv',  av:'🐯'},
};
const MEETINGS=[
  {id:'m1', em:'🏃', name:'판교 퇴근 후 20분 러닝 크루', region:'판교', when:'평일 저녁', cap:6,
   tags:['러닝','운동'], members:['p2','p4','p5'],
   ai:'회원님의 관심사 <b>러닝</b>과 퇴근 동선이 겹쳐요. 세 분 모두 판교에서 근무 중이라 부담 없이 모이기 좋아요.'},
  {id:'m2', em:'🥃', name:'각자 한 잔씩 바꿔 마시기', region:'판교', when:'금요일 저녁', cap:5,
   tags:['위스키','취향'], members:['p1','p6','p8'],
   ai:'취미 <b>위스키</b>가 겹치는 멤버들이에요. 이미 아는 얼굴이 있어 첫 만남의 어색함이 덜할 거예요.'},
  {id:'m3', em:'📊', name:'엑셀 자동화 미니 클리닉', region:'여의도', when:'수요일 점심', cap:6,
   tags:['자동화','업무'], members:['p3','p4','p9','p10'],
   ai:'관심사 <b>자동화</b> 기반 추천이에요. 서로 다른 4개 계열사가 모여 업무 방식을 비교해볼 수 있어요.'},
  {id:'m4', em:'🍲', name:'회사 앞 국밥 원정대', region:'장교', when:'화요일 점심', cap:4,
   tags:['맛집','점심'], members:['p7','p8','p9'],
   ai:'모두 처음 만나는 조합이에요. <b>넓은 인맥</b>을 원하는 회원님께 새로운 연결이 될 수 있어요.'},
  {id:'m5', em:'🎲', name:'보드게임 달밤 모임', region:'판교', when:'목요일 저녁', cap:6,
   tags:['보드게임','전시'], members:['p2','p5','p6','p7'],
   ai:'선호 지역 <b>판교</b>와 저녁 시간대가 딱 맞아요. 계열사 4곳이 섞인 다양한 조합입니다.'},
  {id:'m6', em:'📷', name:'주말 사진 산책단', region:'서울숲', when:'토요일 오후', cap:5,
   tags:['사진','산책'], members:['p3','p6'],
   ai:'취미 <b>사진</b>이 겹쳐요. 소규모라 회원님이 설정한 모임 규모에 가장 가까운 모임이에요.'},
  {id:'m7', em:'🌿', name:'인재경영원 교육 후 저녁 산책', region:'인재경영원', when:'평일 저녁', cap:6,
   tags:['산책','러닝'], members:['p9','p10'],
   ai:'교육 기간에 <b>인재경영원</b>에서 만나기 좋은 모임이에요. 저녁 산책은 처음 만나는 사이에도 부담이 없어요.'},
];
// 로컬 데모용 장소 후보 (실서비스에서는 서버가 웹 검색으로 채운다)
const mapUrl=q=>'https://map.kakao.com/?q='+encodeURIComponent(q);
const PLAN_CANDS={
  m1:[{name:'판교 화랑공원',address:'경기 성남시 분당구 삼평동',url:mapUrl('판교 화랑공원'),why:'트랙이 평탄하고 퇴근 후 모이기 쉬워요'},{name:'판교 중앙공원',address:'경기 성남시 분당구 백현동',url:mapUrl('판교 중앙공원'),why:'3km 코스가 딱 맞아요'},{name:'탄천 산책로 판교 구간',address:'경기 성남시 분당구',url:mapUrl('탄천 산책로 판교'),why:'조명이 있어 저녁에도 안전해요'}],
  m2:[{name:'판교 하이볼 바 달',address:'경기 성남시 분당구 판교역로',url:mapUrl('판교 하이볼'),why:'위스키 종류가 많고 조용해요'},{name:'판교 어탕국수',address:'경기 성남시 분당구 삼평동',url:mapUrl('판교 어탕국수'),why:'안주 겸 저녁으로 좋아요'}],
  m3:[{name:'여의도 한화 라운지',address:'서울 영등포구 여의도동',url:mapUrl('여의도 63빌딩'),why:'노트북 쓰기 좋은 회의 공간'},{name:'여의도 커피 브루잉랩',address:'서울 영등포구 여의나루로',url:mapUrl('여의도 카페'),why:'점심 후 30분 정리하기 좋아요'}],
  m4:[{name:'청진옥',address:'서울 종로구 종로3길',url:mapUrl('청진옥'),why:'장교동에서 도보 10분, 국밥 원조'},{name:'을지로 오래된 다방',address:'서울 중구 을지로',url:mapUrl('을지로 다방'),why:'후식 커피 한 잔'}],
  m5:[{name:'판교 보드게임 카페',address:'경기 성남시 분당구 판교역로',url:mapUrl('판교 보드게임카페'),why:'초심자용 게임이 많아요'},{name:'판교 떡볶이 연구소',address:'경기 성남시 분당구',url:mapUrl('판교 떡볶이'),why:'게임 전 간단히 먹기 좋아요'}],
  m6:[{name:'서울숲 정문',address:'서울 성동구 뚝섬로',url:mapUrl('서울숲'),why:'필름 카메라 산책 시작점'},{name:'성수 베이글',address:'서울 성동구 성수동',url:mapUrl('성수 베이글'),why:'산책 후 브런치'}],
  m7:[{name:'인재경영원 산책로',address:'경기 용인시 처인구',url:mapUrl('한화 인재경영원'),why:'교육 후 바로 모일 수 있어요'},{name:'용인 호수공원',address:'경기 용인시',url:mapUrl('용인 호수공원'),why:'차로 10분, 저녁 산책 코스'}],
};
// inH — 약속 시각을 페이지를 연 시점 기준 시간(h) 오프셋으로 둔다. 실서비스에서는 서버가 meet_at(ISO)을 준다.
// m7 은 이미 시간이 지난 약속이라 확정 투표 없이 자동 확정되는 경로를 그대로 보여준다.
const PLANS={
  m1:{place:'판교 화랑공원 앞',   when:'이번 주 목요일 19:30', inH: 50, act:'가볍게 3km 러닝 후 스트레칭', food:'러닝 후 — 판교역 곰탕집 · 카페 문라이트'},
  m2:{place:'판교 하이볼 바 "달"',when:'이번 주 금요일 19:00', inH: 74, act:'각자 가져온 위스키 한 잔씩 교환 시음', food:'근처 안주 맛집 — 판교 어탕국수 · 치즈플래터'},
  m3:{place:'여의도 한화 라운지', when:'수요일 12:00',        inH: 26, act:'각자 반복 업무 1개씩 가져와 같이 자동화', food:'점심 — 여의도 콩국수 · 커피 브루잉랩'},
  m4:{place:'장교동 본사 앞',     when:'화요일 11:50',        inH:  8, act:'국밥 맛집 릴레이 1차: 청진옥 코스',      food:'후식 — 을지로 오래된 다방'},
  m5:{place:'판교 보드게임 카페', when:'목요일 19:00',        inH: 50, act:'초심자 환영 · 스플렌더 + 텔레스트레이션', food:'근처 — 판교 떡볶이 연구소'},
  m6:{place:'서울숲 정문',        when:'토요일 15:00',        inH: 94, act:'필름 카메라 산책 & 서로 찍어주기',       food:'산책 후 — 성수 베이글 · 로스터리 카페'},
  m7:{place:'인재경영원 산책로',  when:'교육 마친 날 18:30',   inH: -5, act:'캠퍼스 한 바퀴 가볍게 걷기',            food:'산책 후 — 용인 호수공원 카페'},
};
const REPLIES=[
  '좋아요, 저도 그 생각 했어요 😄','오 시간 괜찮으신가요 다들?','저는 목요일이 제일 좋아요!',
  '다들 어느 사옥에서 오세요?','ㅋㅋㅋ 기대되네요','저 처음이라 조금 떨리네요 😅','날짜 정해지면 바로 캘린더에 넣을게요!',
];

/* ================= 상태 ================= */
const S={
  tab:'home',
  profile:{
    nick:'달토끼', av:'🌙', company:'inv', regions:['판교'], age:27, gender:null, mbti:'ENFP',
    interests:['러닝','자동화'], hobbies:['위스키','사진'], sizeMin:4, sizeMax:6,
    sameGender:false, scope:'all', dir:'wide',
  },
  dirty:false,                           // 프로필 변경 후 저장 전 상태
  met:{p1:true,p2:true},                 // 한 번 이상 만난 사람
  feedback:{},                           // 로컬 데모용 만남 평가 (meeting id -> {rating, comment})
  joined:[],                             // 참가한 모임 id
  rooms:{},                              // id -> {msgs, unread, planned, revealed, photos}
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
const $=id=>document.getElementById(id);
const esc=s=>s.replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function nowT(){const d=new Date(),h=d.getHours();return (h<12?'오전 ':'오후 ')+((h%12)||12)+':'+String(d.getMinutes()).padStart(2,'0')}
function toast(a,b){$('toast').innerHTML='<b>'+a+'</b> · '+b;$('toast').classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>$('toast').classList.remove('on'),2600)}

