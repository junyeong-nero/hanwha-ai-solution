# 사전 준비: python3 -m pip install playwright && python3 -m playwright install chromium webkit
# 저장소 루트에서 python3 -m http.server 8766 --bind 127.0.0.1 실행 후 이 스크립트를 실행한다.
import asyncio,json,os
from playwright.async_api import async_playwright
async def flow(browser,size,name):
 page=await browser.new_page(viewport=size,device_scale_factor=1,reduced_motion='reduce')
 errors=[];external=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:external.append(r.url) if not r.url.startswith('http://127.0.0.1') else None)
 await page.goto(os.environ.get('APP_URL','http://127.0.0.1:8766')+'/src/?demo=1')
 await page.get_by_role('button',name='매칭',exact=True).click()
 await page.get_by_role('button',name='참가하기',exact=True).first.click()
 await page.get_by_role('button',name='참가 중 · 채팅방 열기',exact=True).first.click()
 await page.get_by_role('button',name='AI 장소 추천',exact=True).click()
 await page.locator('.place-plan h4').wait_for()
 # 추천 직후 첫 인사 칩이 남아 있어도 두 후보의 핵심 정보가 보여야 한다.
 if size['width']==375:
  comparison=await page.evaluate("""() => {
   const cards=[...document.querySelectorAll('.cand')];
   const bounds=document.querySelector('#msgs').getBoundingClientRect();
   return cards.slice(0,2).every(card=>['.txt b','.cat'].every(selector=>{
    const r=card.querySelector(selector).getBoundingClientRect();
    return r.top>=bounds.top && r.bottom<=bounds.bottom;
   })) && cards[0].getBoundingClientRect().height<170;
  }""")
  assert comparison,'첫 두 후보의 이름·업종이 함께 보여야 한다'
 for selector in ['.cand-reason summary','.cand-actions .opinion']:
  sizes=await page.locator(selector).evaluate_all('(els)=>els.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))')
  assert all(s['w']>=44 and s['h']>=44 for s in sizes),sizes
 await page.locator('.cand-reason summary').first.click()
 assert await page.locator('.cand-reason-panel').first.is_visible()
 await page.locator('.cand-reason summary').first.click()
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
