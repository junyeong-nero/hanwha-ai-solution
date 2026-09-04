# scripts/deploy-supabase.ps1 — Supabase 배포를 한 번에 실행한다.
#
# 사용법 (저장소 루트에서, Windows PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-supabase.ps1
#
# 하는 일: Supabase 로그인 → 프로젝트 연결 → 마이그레이션 적용 → 비밀값 4개 등록 → Edge Function 5개 배포
# OpenRouter 키는 실행 중 물어볼 때 붙여 넣는다 (입력이 화면에 보이지 않고, 파일에 저장되지 않는다).
# DEMO_RESET_TOKEN · DEMO_LOGIN_SECRET 은 자동 생성한다. 실행이 끝나면 초기화 토큰을 한 번만 보여준다.

param([string]$ProjectRef)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Invoke-Step([string]$label, [scriptblock]$block) {
  Write-Host ""
  Write-Host "== $label" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$label 실패 (exit $LASTEXITCODE)" }
}

function New-Token {
  $chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  -join ((1..48) | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}

# ---- 입력 ----
if (-not $ProjectRef) {
  $ProjectRef = Read-Host 'Supabase 프로젝트 ref (대시보드 URL https://supabase.com/dashboard/project/<여기> 의 20자)'
}
if ($ProjectRef -notmatch '^[a-z]{20}$') { throw "프로젝트 ref 형식이 아닙니다: $ProjectRef" }

$secure = Read-Host 'OpenRouter API 키 (붙여 넣어도 화면에 보이지 않음)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$openRouterKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if (-not $openRouterKey.StartsWith('sk-or-')) { throw 'OpenRouter 키 형식이 아닙니다 (sk-or- 로 시작해야 함)' }

$model = Read-Host 'OpenRouter 모델 ID (엔터 = openrouter/free)'
if (-not $model) { $model = 'openrouter/free' }

$resetToken  = New-Token
$loginSecret = New-Token

# ---- 실행 ----
Invoke-Step '[1/5] Supabase 로그인 (브라우저가 열리면 승인)' { npx supabase login }
Invoke-Step "[2/5] 프로젝트 연결 ($ProjectRef) — DB 비밀번호를 물어보면 입력" { npx supabase link --project-ref $ProjectRef }
Invoke-Step '[3/5] 마이그레이션 적용 (supabase/migrations)' { npx supabase db push }
Invoke-Step '[4/5] Edge Function 비밀값 등록' {
  npx supabase secrets set "OPENROUTER_API_KEY=$openRouterKey" "OPENROUTER_MODEL=$model" "DEMO_RESET_TOKEN=$resetToken" "DEMO_LOGIN_SECRET=$loginSecret"
}
$openRouterKey = $null
Invoke-Step '[5/5] Edge Function 배포' {
  npx supabase functions deploy demo-login --no-verify-jwt
  if ($LASTEXITCODE -ne 0) { return }
  npx supabase functions deploy recommend-meetings
  if ($LASTEXITCODE -ne 0) { return }
  npx supabase functions deploy suggest-meeting-plan
  if ($LASTEXITCODE -ne 0) { return }
  npx supabase functions deploy complete-meeting
  if ($LASTEXITCODE -ne 0) { return }
  npx supabase functions deploy reset-demo --no-verify-jwt
}

# ---- 마무리 안내 ----
Write-Host ""
Write-Host "배포 완료." -ForegroundColor Green
Write-Host ""
Write-Host "아래 값은 지금 한 번만 표시됩니다. 안전한 곳에 적어 두세요 (저장소에 넣지 말 것)." -ForegroundColor Yellow
Write-Host "  DEMO_RESET_TOKEN (발표 데이터 초기화 · ?admin=1 화면에서 입력): $resetToken"
Write-Host ""
Write-Host "남은 수동 단계 (docs/deployment.md):"
Write-Host "  1) Dashboard → SQL Editor 에서 supabase/seed.sql 내용 실행 (계열사 8 · 모임 6)"
Write-Host "  2) SQL Editor 에서 발표용 입장 코드 생성 (§4)"
Write-Host "  3) Dashboard → Project Settings → API 의 Project URL 과 anon 키를 src/js/config.js 의 CONFIG 에 입력 후 푸시 (§5)"
Write-Host "  4) OpenRouter 크레딧·모델 ID·남은 한도 확인 (§6)"
