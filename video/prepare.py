"""촬영 원본·프로젝트 근거에서 영상에 쓰는 자료와 자막을 준비한다."""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
VIDEO = ROOT / 'video'
WORK = ROOT / 'outputs/submission-video'
PUBLIC = VIDEO / 'public'

for name in ['matching-reason.png', 'place-reason-detail.png']:
    shutil.copy2(WORK / 'qa' / name, PUBLIC / name)
shutil.copy2(ROOT / 'assets/fonts/PretendardVariable.woff2', PUBLIC / 'PretendardVariable.woff2')
shutil.copytree(ROOT / 'assets/illusts', PUBLIC / 'illusts', dirs_exist_ok=True)

# 토큰은 앱의 단일 정의에서 가져온다.
tokens = re.search(r':root\{(.*?)\n\}', (ROOT / 'src/styles.css').read_text(), re.S).group(1)
styles = '''
*{box-sizing:border-box}body{margin:0}h1,h2,p{margin:0}
.video-root{font-family:Pretendard,sans-serif;color:var(--tx);line-height:1.45;letter-spacing:-.025em}
.brand{position:absolute;left:112px;top:56px;font-size:30px;font-weight:700;display:flex;gap:8px;align-items:center;letter-spacing:-.035em;z-index:2}
.brand b,.accent{color:var(--orange)}
.brand-moon{display:inline-block;width:22px;height:22px;border-radius:50%;background:var(--orange);margin-right:8px;box-shadow:var(--sh-orange)}
.eyebrow{font-size:25px;font-weight:650;color:var(--orange-soft);letter-spacing:.015em}
.demo-copy{position:absolute;left:112px;top:194px;width:1040px}
.demo-label{position:absolute;right:192px;top:111px;font-size:22px;color:var(--tx2);text-align:center;width:400px}
.phone{position:absolute;right:192px;top:157px;width:370px;height:801.17px;overflow:hidden;border-radius:var(--r-xl);border:1px solid var(--line2);box-shadow:var(--sh-2);background:var(--bg)}
.feature-list p{font-size:34px;color:var(--tx2);line-height:1.8}
.feature-list b{display:inline-block;width:205px;color:var(--tx);font-weight:650}
.large-quote{font-size:53px;font-weight:650;line-height:1.55;padding-left:32px;border-left:3px solid var(--orange);letter-spacing:-.04em}
.decision-steps{display:flex;gap:24px;align-items:center;font-size:32px;color:var(--tx2);padding:26px 0;border-bottom:1px solid var(--line2)}
.decision-steps b{color:var(--orange-soft)}
.connection-result{display:flex;gap:65px}
.connection-result p{font-size:28px;color:var(--tx2);margin-bottom:14px}
.connection-result b{font-size:81px;color:var(--orange);letter-spacing:-.05em}
.connection-result span{font-size:32px;color:var(--tx2);font-weight:400;margin:0 8px}
.impact-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:55px;margin-top:60px}
.impact-grid h2{font-size:34px;line-height:1.7;font-weight:650;margin-top:22px}
.impact-grid p:not(.eyebrow){font-size:28px;color:var(--tx2);line-height:1.8;margin-top:10px}
.captions{position:absolute;left:112px;top:843px;width:1065px;min-height:88px;padding:13px 0;display:flex;align-items:center;gap:24px;font-size:34px;font-weight:500;line-height:1.55;white-space:pre-line;letter-spacing:-.02em}
.chapters{position:absolute;left:112px;bottom:27px;display:flex;gap:34px;color:var(--tx3);font-size:22px}
.chapters>div{display:flex;align-items:center;gap:9px;padding-top:13px;border-top:2px solid transparent}
.chapters .active{color:var(--orange-soft);border-color:var(--orange)}
.chapters small{font-size:17px;opacity:.65;font-variant-numeric:tabular-nums}
.timecode{position:absolute;right:112px;bottom:29px;color:var(--tx3);font-size:22px;font-variant-numeric:tabular-nums}
'''
(VIDEO / 'src/index.css').write_text(':root{' + tokens + '\n}\n' + styles)

rows = [
    (1, 5, '취향에서 시작하는 사내 네트워킹, MoonLight Hanwha'),
    (6, 13, '조사 기업의 신규 입사자 중 평균 16.1%가\n1년 안에 퇴사했습니다.'),
    (13.5, 20, '기업 75.6%는 조기 퇴사 1인당 손실을\n2천만원 이상으로 답했습니다.'),
    (20.5, 25, '배치 이후에도 이어지는 동기 교류로\n기존 멘토링과 온보딩을 보완하고자 했습니다.'),
    (25, 30, '동료와의 관계와 소속감이\n초기 적응을 도울 수 있다고 보았습니다.'),
    (30.5, 38, '첫째, GPT-5.4-mini API로\n나와 어울리는 모임을 추천합니다.'),
    (38, 46, '둘째, 채팅 기록을 바탕으로\n함께 만날 장소를 추천합니다.'),
    (46, 55, '셋째, 채팅 기록을 참고해\n다음 스몰토크 주제를 추천합니다.'),
    (55.5, 61, '닉네임·선호 지역·관심사를 설정합니다.'),
    (61, 67, '원하는 관계 방향을 고르고 저장합니다.'),
    (67.5, 74, '선호 지역에서 참가할 모임을 살펴봅니다.'),
    (74, 81, '모임 상세에서 추천 이유와\n멤버의 관심사를 확인할 수 있습니다.'),
    (81.5, 86, '참가하면 내 채팅방이 생깁니다.'),
    (86, 90, '처음 만나는 동료와는 닉네임으로 대화합니다.'),
    (90.5, 96, '“산책 끝나고 닭발 먹을까요?”\n원하는 활동과 음식을 대화에 남깁니다.'),
    (96, 102, 'AI 장소 추천을 누르면\n비교할 수 있는 후보가 도착합니다.'),
    (102.5, 109, '추천 이유를 열어\n우리 대화와 어떻게 맞는지 확인합니다.'),
    (109, 114, '식당·카페·티룸 후보를 함께 비교합니다.'),
    (114, 118, '마음에 드는 장소를 골라 제안합니다.'),
    (118.5, 123, '“이곳 어때요?”를 누르면\n편집 가능한 의견 초안이 들어갑니다.'),
    (123, 127, '내용을 확인한 뒤 직접 보내 대화를 이어갑니다.'),
    (127.5, 135, '채팅 기록을 바탕으로\n다음 스몰토크 주제를 추천받습니다.'),
    (135.5, 142, '이제 실제로 만났다고 가정하겠습니다.\n각자 “만남 완료”를 누릅니다.'),
    (142, 149, '나와 상대가 모두 완료해야\n서로의 실명과 계열사가 보입니다.'),
    (149, 153, '함께 만난 동료가 새로운 연결로 남습니다.'),
    (153, 160, '연결된 동료는 2명에서 4명으로,\n빛나는 계열사는 2곳에서 3곳으로 늘었습니다.'),
    (160.5, 166.5, '새로운 동료를 발견하고 첫 대화의 부담을 낮춰,\n계열사 간 교류가 일상으로 이어지길 기대합니다.'),
    (166.5, 173, '교육 동기부터 시범 운영하고,\n사용자 의견을 받아 개선하겠습니다.'),
    (173, 179, '참가율·만남 완료율·새 연결 수와\n재참여·만족도를 측정하겠습니다.'),
    (179.5, 184, '오늘의 산책 친구가, 내일의 협업 동료로.\nMoonLight Hanwha'),
]
captions = [dict(text=text, startMs=round(a*1000), endMs=round(b*1000), timestampMs=None, confidence=None) for a,b,text in rows]
for i, item in enumerate(captions):
    assert 0 <= item['startMs'] < item['endMs'] <= 185000
    assert i == 0 or captions[i-1]['endMs'] <= item['startMs']
    assert max(map(len,item['text'].splitlines())) <= 45
(VIDEO / 'src/captions.json').write_text(json.dumps(captions,ensure_ascii=False,indent=2)+'\n')

def stamp(seconds):
    ms = round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

(ROOT / 'assets/video.srt').write_text('\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{text}\n' for i,(a,b,text) in enumerate(rows)))
script = ['# MoonLight Hanwha 제출 영상 대본', '', '185초 · 1920×1080 · 30fps · 자막·잔잔한 배경음·효과음 · Remotion', '', '| 구간 | 화면 자막 |', '| --- | --- |']
script += [f'| {stamp(a)[:8]}–{stamp(b)[:8]} | '+text.replace('\n',' / ')+' |' for a,b,text in rows]
script += ['', '## 근거와 시연 범위', '', '- 도입부는 [보고서의 해결할 문제와 대상](../assets/report.md#해결할-문제와-대상) 섹션만 참고해 구성했다.', '- 고용노동부·한국고용정보원 「2023년 하반기 기업 채용동향조사」: 신규 입사자 1년 내 퇴사율 평균 16.1%, 조기 퇴사자 1인당 채용·교육 등 손실을 2천만원 이상으로 응답한 기업 75.6%. 매출 상위 500대 기업 중 315개사 인사담당자의 응답이며 신입·경력을 모두 포함한다. 한화 자체 수치가 아니다. [고용노동부 공식 발표, 2024.03.24](https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=16352)', '- 접근 이유는 기존 멘토링·온보딩에 배치 후 동기 교류를 더하고, 관계 형성과 소속감이 초기 적응을 도울 수 있다는 가설이다. [Gallup](https://www.gallup.com/workplace/397058/increasing-importance-best-friend-work.aspx)', '- 외부 연구: 유승완·박난주·이찬 (2025), 「중소기업 근로자의 피드백 환경 및 일터우정과 이직의도의 관계에서 개인-조직 적합성의 매개효과」. [KCI 원문](https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003292988)', '- 국내 중소기업 재직자 1,769명의 설문 분석이다. 한화 자체 조사나 서비스 효과의 인과 검증으로 제시하지 않는다.', '- 프로토타입의 실제 버튼을 조작한 로컬 데모다. 추천·답장·다른 멤버의 만남 완료는 샘플 데이터와 시뮬레이션이다. 영상에서 실제 외부 AI·카카오 검색·웹 검색을 호출하지 않는다.', '- AI 활용 사례는 GPT-5.4-mini API를 사용한 매칭, 채팅 기록 기반 만남 장소 추천, 채팅 기록 기반 스몰토크 주제 추천의 세 가지다.', '- 이번 시연의 연결 동료 2→4명, 계열사 2→3곳은 샘플 상태의 변화다. 현업 효과는 파일럿에서 별도로 측정한다.', '- 시간·장소 확정과 투표는 현재 흐름에 포함하지 않는다.', '']
(VIDEO / '대본.md').write_text('\n'.join(script))

subprocess.run([sys.executable, str(VIDEO/'soundtrack.py')],check=True)
print(f'185초 · AI 활용 사례 3가지 · 자막 {len(captions)}개 · 클립 8개 · 배경음과 효과음 준비 완료')
