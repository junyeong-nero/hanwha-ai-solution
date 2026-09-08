# MoonLight Hanwha 제출 영상

Remotion으로 편집한 3분 5초 제출 영상입니다. 문제 근거·AI 활용 사례 3가지·실제 앱 시연·기대효과를 사용자 관점으로 설명합니다.

- 최종 파일: [assets/video.mp4](../assets/video.mp4)
- 웹 미리보기: [assets/video.html](../assets/video.html)
- 전체 대본과 근거: [대본.md](대본.md)
- 자막: [assets/video.srt](../assets/video.srt), 원본 데이터는 `src/captions.json`
- 제작 규격: 1920×1080, 30fps, 185초, H.264/AAC, 자막·잔잔한 배경음·효과음, TTS 없음
- 사용자 제공 일러스트 5장: `assets/illusts/` 원본을 수정하지 않고 복사하여 도입·만남·기대효과 장면에 사용

| 구간 | 내용 |
| --- | --- |
| 00:00–00:05 | 메인 화면: 달빛 아래, 하나의 한화. |
| 00:05–00:30 | 입사 후 정착 문제 → 조기 퇴사의 손실 → 배치 후 동기 교류에 주목한 이유 |
| 00:30–00:55 | GPT-5.4-mini API 매칭, 채팅 기록 기반 장소 추천·스몰토크 주제 추천 |
| 00:55–01:30 | 프로필 설정, 모임 상세, 참가와 익명 채팅 |
| 01:30–02:15 | 대화 기반 장소 후보, 추천 이유, 의견 초안 전송, 스몰토크 |
| 02:15–02:40 | 상호 만남 완료, 실명 공개, 동료와 계열사 연결 |
| 02:40–03:05 | 기대효과, 파일럿·측정 계획, 체험 안내 |

## 미리보기와 수정

```bash
cd video
npm ci
npm run dev
```

표시된 Studio 주소의 `/MoonLightHanwha`를 엽니다. `src/scenes/`의 6개 장면과 `src/captions.json`에서 내용·타이밍을 수정할 수 있습니다. 앱 자체는 기존 빌드 없는 구조를 유지합니다.

```bash
npm run lint
npm run render
```

렌더 결과는 `outputs/submission-video/MoonLight_Hanwha_제출영상.mp4`입니다. 최종 확인 후 `assets/video.mp4`에 복사합니다. Chrome이 자동으로 발견되지 않으면 렌더 명령에 `--browser-executable`로 설치 경로를 지정할 수 있습니다.

## 촬영 재현

Python Playwright와 Chromium, FFmpeg가 필요합니다. 저장소 루트에서 로컬 서버를 실행한 뒤 다른 터미널에서 촬영합니다.

```bash
python3 -m http.server 8766 --bind 127.0.0.1
```

```bash
mkdir -p outputs/submission-video/raw outputs/submission-video/qa
python3 video/record-demo.py
```

375×812 CSS 뷰포트에서 실제 버튼만 조작합니다. 외부 네트워크 요청과 브라우저 오류가 없고, 의견 초안·전송·질문 생성·연결 수가 기대한 상태인지 검사합니다. 인코더 시간과 실제 조작 시간의 차이는 작은 촬영 표식으로 맞추며, 최종 클립에서는 표식을 제거합니다. 앱 데이터나 기능은 바꾸지 않습니다. 촬영 중 다른 작업과 섞이지 않도록 현재 앱 파일을 `outputs/`에 복사해 사용합니다.

`prepare.py`는 QA 화면에서 확대 이미지, 앱 디자인 토큰, 자막·대본을 준비하고 `soundtrack.py`를 실행합니다. `public/` 자료는 이미 준비되어 있어 재촬영 없이도 Studio와 렌더가 동작합니다.

`python3 video/soundtrack.py`로 72 BPM의 건반·패드 배경음과 20개 효과음을 다시 만들 수 있습니다. NumPy와 FFmpeg를 사용하며, 외부 음원 없이 직접 합성합니다. 장면 전환·참가·장소 후보·메시지 전송·만남 완료에 맞춰 짧은 효과음을 배치했습니다. Remotion은 `public/music.m4a`와 `public/effects.m4a`를 함께 재생합니다. 시작·끝에는 페이드를 적용하고 시연 중에는 배경음을 조금 낮춥니다.

## 시연의 범위

영상은 `?demo=1`의 샘플 데이터 시연입니다. 다른 멤버의 답장·만남 완료는 앱의 시뮬레이션이며, 실제 만남 이후를 가정한 장면에는 이를 표시했습니다. 실제 외부 AI·카카오 검색·웹 검색을 호출한 녹화가 아닙니다. AI 기능 설명은 실제 구현을 바탕으로 작성했습니다.

외부 연구는 문제 설정의 근거이고, 서비스 효과를 측정한 결과가 아닙니다. 시간·장소 확정과 투표는 현재 기능에서 제외되어 영상에서도 삭제했습니다. 기존 영상 원본은 `outputs/submission-video/previous-video.mp4`에 보존했습니다.
