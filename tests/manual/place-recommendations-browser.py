# 사전 준비: python3 -m pip install playwright && python3 -m playwright install chromium webkit
# 저장소 루트에서 python3 -m http.server 8766 --bind 127.0.0.1 실행 후 이 스크립트를 실행한다.
import asyncio,json
from playwright.async_api import async_playwright
async def flow(browser,size,name):
 page=await browser.new_page(viewport=size,device_scale_factor=1,reduced_motion='reduce')
 errors=[];external=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:external.append(r.url) if not r.url.startswith('http://127.0.0.1') else None)
 await page.goto('http://127.0.0.1:8766/src/?demo=1')
 await page.get_by_role('button',name='매칭',exact=True).click()
 await page.get_by_role('button',name='참가하기',exact=True).first.click()
 await page.get_by_role('button',name='참가 중 · 채팅방 열기',exact=True).first.click()
 await page.get_by_role('button',name='AI 장소 추천',exact=True).click()
 await page.locator('.place-plan h4').wait_for()
 await page.locator('.place-plan h4').scroll_into_view_if_needed()
 await page.wait_for_timeout(3000)
 await page.screenshot(path='/tmp/places-'+name+'.png')
 assert await page.locator('.place-plan .cand').count()==3
 assert not await page.get_by_role('button',name='이 약속으로 확정',exact=True).count()
 await page.get_by_role('button',name='이곳 어때요?',exact=True).first.click()
 assert '에서 만나면 어떨까요?' in await page.locator('#cin').input_value()
 assert not await page.locator('.msg.me').count()
 await page.get_by_role('button',name='보내기',exact=True).click()
 assert await page.locator('.msg.me').count()==1
 await page.get_by_role('button',name='AI 장소 추천',exact=True).click()
 assert await page.locator('.previous-places').count()==1
 assert not await page.locator('.previous-places').get_attribute('open')
 # 모바일·웹 화면 안에서 후보와 입력창의 실제 가로 경계를 검증한다.
 overflow=await page.evaluate('''() => [...document.querySelectorAll('.place-plan,.cand,#composer,#rbanner')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||e.scrollWidth>e.clientWidth+1}).map(e=>e.className||e.id)''')
 assert not overflow,overflow
 await page.get_by_role('button',name='홈',exact=True).click()
 assert await page.locator('#nextcard').inner_text()==''
 await page.get_by_role('button',name='프로필',exact=True).click()
 await page.get_by_role('button',name='도움말',exact=True).click()
 assert 'AI 장소 추천 기능 써보기' in await page.locator('#usageGuide').inner_text()
 assert not errors,errors
 assert not external,external
 print(json.dumps({'viewport':name,'console_errors':errors,'external_requests':external,'overflow':overflow,'flow':'참가 → 후보·이유 → 초안 → 전송 → 재추천 → 가이드 완료'},ensure_ascii=False))
 await page.close()
async def main():
 async with async_playwright() as p:
  for engine in ['chromium','webkit']:
   browser=await getattr(p,engine).launch()
   for name,size in [('mobile',{'width':375,'height':812}),('web',{'width':1440,'height':1000})]:await flow(browser,size,engine+'-'+name)
   await browser.close()
asyncio.run(main())
