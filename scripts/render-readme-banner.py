"""실제 로컬 데모 화면으로 README 배너 생성 (Python Playwright·Chromium 필요)."""
import asyncio
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from threading import Thread

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets/screenshots'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def data_url(content, mime):
    return f'data:{mime};base64,' + base64.b64encode(content).decode()


async def render(url):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 375, 'height': 812},
                                      device_scale_factor=2, reduced_motion='reduce')
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(url + '/src/?demo=1')
        await page.evaluate('document.fonts.ready')
        await page.locator('#space .planet').first.wait_for()
        home = await page.screenshot()
        await page.get_by_role('button', name='매칭', exact=True).click()
        await page.get_by_role('button', name='참가하기', exact=True).first.wait_for()
        matching = await page.screenshot()
        assert not errors, errors

        # 앱과 같은 폰트·디자인 토큰을 사용하고 화면 캡처는 그대로 배치한다.
        css = (ROOT / 'src/styles.css').read_text()
        tokens = re.search(r':root\{(.*?)\n\}', css, re.S).group(1)
        font = data_url((ROOT / 'assets/fonts/PretendardVariable.woff2').read_bytes(), 'font/woff2')
        html = '''<!doctype html><html lang="ko"><meta charset="utf-8"><style>
        @font-face{font-family:Pretendard;src:url("FONT")}
        :root{TOKENS}
        *{box-sizing:border-box}body{margin:0;font-family:Pretendard,sans-serif;color:var(--tx)}
        .banner{width:1600px;height:850px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 85% 90%,var(--orange-a18),transparent 50%),radial-gradient(ellipse at 50% 0%,var(--card3),transparent 65%),var(--bg)}
        .orbit{position:absolute;width:1050px;height:1050px;border:1px solid var(--line2);border-radius:50%;top:-90px;left:735px}
        .orbit.two{width:1330px;height:1330px;top:-230px;left:595px}
        .dot{position:absolute;width:10px;height:10px;border-radius:50%;background:var(--orange);top:110px;left:780px;box-shadow:var(--sh-orange)}
        .copy{position:absolute;left:80px;top:85px;z-index:2}
        .brand{font-size:29px;font-weight:760;letter-spacing:-1px}.brand span{color:var(--orange)}
        .eyebrow{margin-top:88px;color:var(--orange-soft);font-size:19px;font-weight:650;letter-spacing:3px}
        h1{font-size:76px;line-height:1.17;letter-spacing:-4px;margin:24px 0 28px;font-weight:780}
        h1 span{color:var(--moon)}
        .desc{font-size:25px;line-height:1.7;color:var(--tx2);letter-spacing:-.5px}
        .steps{display:flex;align-items:center;gap:18px;margin-top:56px;font-size:19px;font-weight:650}.steps i{font-style:normal;color:var(--orange)}
        .footer{position:absolute;bottom:46px;left:80px;color:var(--tx3);font-size:16px;letter-spacing:1px}
        .phone{position:absolute;width:310px;padding:7px;background:var(--card2);border:1px solid var(--line2);border-radius:var(--r-xl);box-shadow:var(--sh-2)}
        .phone img{width:100%;display:block;border-radius:var(--r-l)}
        .home{left:866px;top:72px;transform:rotate(-4deg)}
        .matching{left:1210px;top:142px;transform:rotate(4deg)}
        .label{position:absolute;top:-36px;left:12px;color:var(--tx2);font-size:16px;font-weight:600;letter-spacing:1px}
        </style><div class="banner"><div class="orbit"></div><div class="orbit two"></div><div class="dot"></div>
        <div class="copy"><div class="brand">MoonLight <span>Hanwha</span></div>
        <div class="eyebrow">한화 구성원을 위한 사내 네트워킹</div>
        <h1>새로운 동료와,<br><span>내 우주가 넓어지는 순간.</span></h1>
        <div class="desc">AI가 찾아준 모임에서 가볍게 시작해요.<br>익명의 대화가 실제 만남과 연결이 됩니다.</div>
        <div class="steps"><span>AI 모임 추천</span><i>→</i><span>익명 대화</span><i>→</i><span>새로운 연결</span></div></div>
        <div class="phone home"><div class="label">홈 · 나의 우주</div><img src="HOME"></div>
        <div class="phone matching"><div class="label">매칭 · 모임 둘러보기</div><img src="MATCHING"></div>
        <div class="footer">실제 웹앱의 로컬 데모 화면</div></div></html>'''
        html = html.replace('TOKENS', tokens).replace('FONT', font)
        html = html.replace('HOME', data_url(home, 'image/png')).replace('MATCHING', data_url(matching, 'image/png'))
        await page.set_viewport_size({'width': 1600, 'height': 850})
        await page.set_content(html)
        await page.evaluate('document.fonts.ready')
        await page.locator('img').evaluate_all('(images)=>Promise.all(images.map(image=>image.decode()))')
        await page.screenshot(path=str(OUTPUT / 'readme-banner.png'), scale='css')
        await browser.close()
    print('배너 생성 완료: assets/screenshots/readme-banner.png')


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(render(f'http://127.0.0.1:{server.server_port}'))
    finally:
        server.shutdown()
        server.server_close()
