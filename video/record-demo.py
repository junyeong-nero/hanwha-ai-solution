"""현재 앱을 375×812 화면에서 실제 조작해 촬영한다. 외부 요청은 허용하지 않는다."""
import asyncio
import json
import pathlib
import shutil
import subprocess
import time
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'outputs/submission-video'
PUBLIC = ROOT / 'video/public'
COLORS = [(230,40,60),(40,230,70),(40,70,230),(230,210,40),(210,40,230),(40,210,230),(230,130,40),(130,40,230),(250,250,250)]


async def main():
    # 다른 작업의 앱 수정과 섞이지 않도록 이번 촬영의 소스를 고정한다.
    snapshot = WORK / 'app-snapshot'
    shutil.copytree(ROOT / 'src', snapshot / 'src', dirs_exist_ok=True)
    shutil.copytree(ROOT / 'assets/fonts', snapshot / 'assets/fonts', dirs_exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(
            viewport={'width': 375, 'height': 812}, device_scale_factor=2,
            record_video_dir=str(WORK / 'raw'),
            record_video_size={'width': 750, 'height': 1624},
        )
        external, errors, segments = [], [], []

        async def route(request):
            if request.request.url.startswith('http://127.0.0.1:8766/'):
                await request.continue_()
            else:
                external.append(request.request.url)
                await request.abort()

        await context.route('**/*', route)
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto('http://127.0.0.1:8766/outputs/submission-video/app-snapshot/src/?demo=1')
        await page.evaluate('document.fonts.ready')
        await page.wait_for_timeout(1000)
        # 클릭 위치 표시만 추가한다. 앱 데이터·기능은 변경하지 않는다.
        await page.evaluate('''() => {
          const marker = document.createElement('div');
          marker.id = 'record-marker';
          Object.assign(marker.style, {position:'fixed',left:'0',top:'0',width:'12px',height:'6px',zIndex:10000,pointerEvents:'none'});
          document.body.append(marker);
          document.addEventListener('pointerdown', e => {
            const dot = document.createElement('div');
            Object.assign(dot.style, {position:'fixed',left:(e.clientX-19)+'px',top:(e.clientY-19)+'px',
              width:'38px',height:'38px',border:'2px solid #F37321',borderRadius:'50%',
              background:'rgba(243,115,33,.18)',pointerEvents:'none',zIndex:9999});
            document.body.append(dot);
            dot.animate([{opacity:1,transform:'scale(.7)'},{opacity:0,transform:'scale(1.5)'}],700);
            setTimeout(()=>dot.remove(),700);
          },true);
        }''')
        start = time.monotonic()

        async def pause(seconds):
            await page.wait_for_timeout(seconds * 1000)

        async def click(locator):
            await locator.scroll_into_view_if_needed()
            await pause(.3)
            await locator.click()

        async def nav(name):
            await click(page.get_by_role('button', name=name, exact=True))

        async def segment(name, duration, action):
            began = time.monotonic()
            await page.locator('#record-marker').evaluate('(el,rgb)=>el.style.background=`rgb(${rgb.join(",")})`', COLORS[len(segments)])
            segments.append({'name': name, 'start': began - start, 'duration': duration})
            await action()
            remaining = duration - (time.monotonic() - began)
            assert remaining > .2, f'{name}: 촬영 구간 시간 초과 ({remaining:.2f})'
            await page.screenshot(path=str(WORK / 'qa' / (name + '.png')))
            print(f'{name}: 조작 완료 · {remaining:.1f}초 표시', flush=True)
            await pause(remaining)

        async def profile():
            await nav('프로필')
            await pause(.6)
            await page.locator('#nick').fill('달빛러너')
            await click(page.locator('#f-int button[data-v="전시"]'))
            if 'on' not in (await page.locator('#f-region button[data-v="인재경영원"]').get_attribute('class')):
                await click(page.locator('#f-region button[data-v="인재경영원"]'))
            await pause(1.2)
            await page.locator('#f-dir').evaluate("el=>el.scrollIntoView({block:'center',behavior:'smooth'})")
            await pause(1.5)
            await click(page.locator('#f-dir button[onclick="setP(\'dir\',\'wide\')"]'))
            await pause(1)
            await click(page.locator('#saveBtn'))

        async def matching():
            await nav('매칭')
            await pause(2)
            target = page.locator('.meet').filter(has=page.locator('[onclick="openDetail(\'m7\')"]'))
            await target.evaluate("el=>el.scrollIntoView({block:'center',behavior:'smooth'})")
            await pause(2.5)
            await click(target.locator('.hd'))
            await pause(2)
            await page.locator('#dt-body .ai').screenshot(path=str(WORK / 'qa/matching-reason.png'))

        async def joining():
            await click(page.locator('#dt-cta button'))
            await pause(1)
            await click(page.locator('[onclick="openJoined(\'m7\')"]'))
            await pause(1.5)
            await page.locator('#cin').type('안녕하세요! 같이 산책해요.', delay=55)
            await nav('보내기')

        async def intent():
            await pause(.8)
            await page.locator('#cin').type('산책 끝나고 닭발 먹을까요?', delay=65)
            await nav('보내기')
            await pause(2.5)
            await nav('AI 장소 추천')
            await page.locator('.place-plan h4').wait_for()
            assert '닭발' in await page.locator('.place-plan').inner_text()
            await pause(1.5)

        async def compare():
            await pause(1)
            await click(page.locator('.cand-reason summary').first)
            await pause(3)
            await page.screenshot(path=str(WORK / 'qa/place-reason.png'))
            await page.locator('.cand-reason-panel').first.screenshot(path=str(WORK / 'qa/place-reason-detail.png'))
            await click(page.locator('.cand-reason summary').first)
            await page.locator('.cand').nth(1).evaluate("el=>el.scrollIntoView({block:'center',behavior:'smooth'})")
            await pause(2.5)
            await page.locator('.place-plan').evaluate("el=>el.scrollIntoView({block:'start',behavior:'smooth'})")
            await pause(2)

        async def draft():
            await click(page.get_by_role('button', name='이곳 어때요?', exact=True).first)
            assert '에서 만나면 어떨까요?' in await page.locator('#cin').input_value()
            await pause(2)
            await nav('보내기')
            await pause(2)
            assert await page.locator('.msg.me').count() == 3

        async def smalltalk():
            await nav('더보기')
            await click(page.locator('[onclick="openSmallTalk()"]'))
            await page.locator('#talk-topic').fill('러닝')
            await click(page.get_by_role('button', name='대화 주제 추천받기', exact=True))
            await page.locator('.talk-topic').first.evaluate("el=>el.scrollIntoView({block:'start',behavior:'smooth'})")
            await pause(1.5)
            assert await page.locator('.talk-topic').count() == 3

        async def reveal():
            await nav('스몰토크 닫기')
            await nav('더보기')
            await click(page.locator('#plusReveal'))
            await pause(1.4)
            await click(page.locator('#cf-ok'))
            await page.locator('#ratewrap.on').wait_for()
            await pause(.5)
            await nav('5점')
            await click(page.locator('#ratebtn'))
            await pause(4.5)
            await nav('채팅방 멤버 보기')
            await pause(2)
            await page.screenshot(path=str(WORK / 'qa/members-revealed.png'))
            await click(page.locator('button[onclick="hideMembers()"]'))
            await nav('홈')
            await page.screenshot(path=str(WORK / 'qa/home-connected.png'))
            assert '4명' in await page.locator('#spacestats').inner_text()

        try:
            for name, duration, action in [
                ('profile', 12, profile), ('matching', 14, matching), ('joining', 9, joining),
                ('intent', 12, intent), ('compare', 16, compare), ('draft', 9, draft),
                ('smalltalk', 8, smalltalk), ('reveal', 25, reveal),
            ]:
                await segment(name, duration, action)
            await page.locator('#record-marker').evaluate('(el,rgb)=>el.style.background=`rgb(${rgb.join(",")})`', COLORS[-1])
            await pause(.5)
            total = time.monotonic() - start
            assert not errors, errors
            assert not external, external
        except Exception:
            await page.screenshot(path=str(WORK / 'qa/record-error.png'))
            print((await page.locator('body').inner_text())[-7000:], flush=True)
            raise
        finally:
            video = page.video
            await context.close()
            await video.save_as(str(WORK / 'raw/demo.webm'))
            await browser.close()

        raw_duration = float(subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
            str(WORK / 'raw/demo.webm'),
        ]))
        # 브라우저 시계와 인코더 시계는 다를 수 있다. 기록된 색 표식으로 실제 프레임 경계를 찾는다.
        pixels = subprocess.check_output(['ffmpeg','-v','error','-i',str(WORK/'raw/demo.webm'),'-vf','fps=25,crop=4:4:4:0,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'])
        starts = []
        cursor = 0
        for color in COLORS:
            found = next((i for i in range(cursor,len(pixels)//3) if sum((pixels[3*i+j]-color[j])**2 for j in range(3)) < 2200), None)
            assert found is not None, f'촬영 표식 누락: {color}'
            starts.append(found/25)
            cursor = found + 1
        for i, item in enumerate(segments):
            item['video_start'] = starts[i]
            item['video_duration'] = starts[i+1] - starts[i]
            assert item['video_duration'] > item['duration'] * .8
            subprocess.run([
                'ffmpeg', '-y', '-v', 'error', '-ss', str(item['video_start']),
                '-t', str(item['video_duration']),
                '-i', str(WORK / 'raw/demo.webm'), '-t', str(item['duration']),
                '-vf', f'crop=375:812:0:0:exact=1,drawbox=x=0:y=0:w=12:h=6:color=0x090C18:t=fill,setpts={item["duration"]/item["video_duration"]}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration=0.1,scale=750:1624', '-c:v', 'libx264', '-crf', '17',
                '-preset', 'fast', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
                str(PUBLIC / (item['name'] + '.mp4')),
            ], check=True)
        (WORK / 'recording.json').write_text(json.dumps({
            'segments': segments, 'rawDuration': raw_duration, 'wallDuration': total,
            'consoleErrors': errors, 'externalRequests': external,
            'mode': '로컬 데모 · 샘플 데이터 · 실제 앱 조작',
        }, ensure_ascii=False, indent=2))
        print('전체 촬영·클립 분할 완료', flush=True)


asyncio.run(main())
