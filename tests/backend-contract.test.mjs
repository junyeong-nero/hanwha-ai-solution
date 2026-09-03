import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const env = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

/* ===== Task 1: 비밀 키 미노출 · 환경 예시 ===== */

test('브라우저 설정에는 OpenRouter 비밀 키가 없다', () => {
  assert.doesNotMatch(html, /OPENROUTER_API_KEY|SUPABASE_SECRET_KEY|service_role/);
  assert.doesNotMatch(html, /sk-or-v1-[A-Za-z0-9]/);
});

test('환경 예시는 공개 키와 함수 설정을 구분한다', () => {
  assert.match(env, /SUPABASE_ANON_KEY/);
  assert.match(env, /OPENROUTER_MODEL/);
  assert.doesNotMatch(env, /sk-or-v1-[A-Za-z0-9]/);
  assert.doesNotMatch(env, /OPENROUTER_API_KEY\s*=\s*\S/);
});

test('이중 모드: CONFIG에는 URL과 anon 키만 들어가고, 키가 있으면 role 이 anon 이어야 한다', () => {
  const m = html.match(/const CONFIG=\{SUPABASE_URL:'([^']*)',SUPABASE_ANON_KEY:'([^']*)',DEMO_MODE:(true|false)\}/);
  assert.ok(m, 'CONFIG 블록 형식');
  const [, url, key] = m;
  if (url || key) {
    assert.match(url, /^https:\/\/[a-z]{20}\.supabase\.co$/);
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(payload.role, 'anon', 'CONFIG 의 키는 anon(publishable) 키여야 한다');
  }
  assert.match(html, /const BACKEND=!!\(CONFIG\.SUPABASE_URL&&CONFIG\.SUPABASE_ANON_KEY\)/);
  // supabase-js는 백엔드 모드에서만 동적으로 로드한다 (정적 <script src>로 넣지 않는다)
  assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*supabase/);
  assert.match(html, /loadScript\('https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/);
});

/* ===== Task 3: 발표 입장 화면 ===== */

test('입장 화면은 demo-login 으로 세션을 받아 설정한다 (익명 세션 사용 안 함)', () => {
  assert.match(html, /callFn\('demo-login',\{code,company_id:coId,employee_no:emp,real_name:name,nickname:nick\}\)/);
  assert.match(html, /sb\.auth\.setSession\(d\.session\)/);
  assert.doesNotMatch(html, /signInAnonymously/);
  assert.match(html, /SUPABASE_URL/);
  assert.match(html, /SUPABASE_ANON_KEY/);
});

test('입장 화면은 입장 코드·계열사·사번·이름을 받는다 (동명이인 구분·데이터 복원)', () => {
  assert.match(html, /<input id="e-code"/);
  assert.match(html, /<select id="e-co"/);
  assert.match(html, /<input id="e-emp"/);
  assert.match(html, /<input id="e-name"/);
  assert.match(html, /<input id="e-nick"/);
  assert.match(html, /사번은 본인 확인과 데이터 복원에만 쓰이며/);
});

test('백엔드 모드에서는 계열사가 로그인 정보로 고정된다', () => {
  assert.match(html, /\$\('f-co'\)\.disabled=!!\(BACKEND&&ME\)/);
});

test('입장 오류마다 한국어 안내가 보인다', () => {
  assert.match(html, /입장 코드가 만료됐어요/);
  assert.match(html, /입장 코드가 올바르지 않아요/);
  assert.match(html, /사번과 이름이 일치하지 않아요/);
});

test('입력 요소는 iOS 확대 방지를 위해 16px 이상이다', () => {
  assert.match(html, /input,select\{font-family:inherit;font-size:16px\}/);
});

/* ===== Task 5: 모임 참가 · Realtime 채팅 ===== */

test('Realtime 채팅 계약: 채널 구독·멤버십·RPC·500자 제한', () => {
  assert.match(html, /\.channel\('room-'/);
  assert.match(html, /postgres_changes/);
  assert.match(html, /from\('meeting_members'\)/);
  assert.match(html, /rpc\('room_members'/);
  assert.match(html, /rpc\('room_summaries'/);
  assert.match(html, /rpc\('my_connections'/);
  assert.match(html, /slice\(0,500\)/);
});

test('기존 데모 함수 이름이 유지된다', () => {
  for (const fn of ['joinMeet', 'sendMsg', 'openRoom', 'aiPlan', 'confirmPlan', 'doReveal']) {
    assert.match(html, new RegExp(`function ${fn}\\(`), `${fn} 가 있어야 한다`);
  }
});

test('실명은 profiles를 직접 조회해 얻지 않는다 (RPC만 사용)', () => {
  // 다른 사용자의 real_name을 profiles 테이블에서 select 하지 않는다
  assert.doesNotMatch(html, /from\('profiles'\)\.select\([^)]*real_name/);
});

/* ===== Task 6: AI 약속 · 만남 완료 · AI 전송 안내 ===== */

test('AI 약속과 만남 완료는 Edge Function을 호출한다', () => {
  assert.match(html, /callFn\('suggest-meeting-plan'/);
  assert.match(html, /callFn\('complete-meeting'/);
  assert.match(html, /from\('meeting_plans'\)\.update\(\{confirmed:true\}\)/);
});

test('AI 전송 안내 문구가 + 메뉴에 있다', () => {
  assert.match(html, /최근 대화 일부가 익명 처리되어 외부 AI에 전송돼요/);
});

/* ===== Task 7: 장애 안내 · 초기화 ===== */

test('장애 상황마다 한국어 안내와 다시 시도 문구가 있다', () => {
  assert.match(html, /네트워크 오류/);
  assert.match(html, /다시 시도/);
  assert.match(html, /AI 응답이 지연되어 기본 추천을 보여드려요/);
  assert.match(html, /AI 응답이 지연되어 기본 약속안을 보여드려요/);
  assert.match(html, /세션이 만료됐어요/);
});

test('초기화 컨트롤은 ?admin=1 에서만 보이고 토큰 헤더로 호출한다', () => {
  assert.match(html, /get\('admin'\)==='1'/);
  assert.match(html, /callFn\('reset-demo',\{\},\{'x-demo-reset-token':tok\}\)/);
});

test('프론트엔드에는 LLM 프롬프트나 OpenRouter 호출이 없다', () => {
  assert.doesNotMatch(html, /openrouter\.ai/);
  assert.doesNotMatch(html, /chat\/completions/);
  assert.doesNotMatch(html, /"role"\s*:\s*"system"/);
});
