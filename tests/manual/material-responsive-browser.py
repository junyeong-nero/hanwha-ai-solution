"""별도 로컬 서버와 기존 Python Playwright로 실행하는 반응형 회귀 확인."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright

URL=os.environ.get('MATERIAL_UI_URL','http://127.0.0.1:8792/src/?demo=1')
ORIGIN=URL.split('/src/')[0]
OUT=Path('outputs/ui-alignment');OUT.mkdir(parents=True,exist_ok=True)

async def bounds(locator):
 return await locator.evaluate('(e)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}')

async def check_layout(page,width):
 for tab in ['홈','매칭','채팅','프로필']:
  await page.get_by_role('button',name=tab,exact=True).click()
  await page.locator('.tabpane.on').evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.finished))')
  assert await page.locator('.tabpane.on').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(width,tab,'가로 넘침')
  header=await bounds(page.locator('.tabpane.on>.top'))
  content=await bounds(page.locator({'홈':'#colist','매칭':'#matchsub','채팅':'#roomlist','프로필':'.profile-grid'}[tab]))
  assert abs(header['x']-content['x'])<1,(width,tab,'왼쪽 경계')
  assert abs(header['right']-content['right'])<1,(width,tab,'오른쪽 경계')
  if tab=='프로필':
   actions=await bounds(page.locator('.profile-actions'))
   nav=await bounds(page.locator('#nav'))
   assert abs(actions['bottom']-(nav['y'] if width<1024 else nav['bottom']))<2,(width,actions,nav)
   assert await page.locator('#profileNext').evaluate('(e)=>e.checkVisibility()')
   targets=await page.locator('#tab-profile button').evaluate_all('(es)=>es.filter(e=>e.checkVisibility()&&!e.disabled).map(e=>({label:e.textContent,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))')
   assert all(t['w']>=44 and t['h']>=44 for t in targets),(width,targets)

async def flow(page,engine,width):
 await page.get_by_role('button',name='프로필',exact=True).click()
 await page.locator('#f-region').get_by_role('button',name='여의도',exact=True).click()
 assert await page.locator('#f-region').get_by_role('button',name='여의도',exact=True).get_attribute('aria-pressed')=='true'
 await page.get_by_role('button',name='저장하고 둘러보기',exact=True).click()
 await page.locator('#tab-match.on').wait_for(state='visible')
 assert await page.evaluate('!S.dirty')
 await page.screenshot(path=str(OUT/f'{engine}-{width}-match.png'))
 # 제목은 키보드로 열 수 있고 참가 버튼은 채팅방을 만든다.
 title=page.locator('.meet .hd').first
 await title.focus();await title.press('Enter')
 await page.locator('#detailwrap.on').wait_for(state='visible')
 await page.locator('#dt-cta').get_by_role('button',name='참가하기',exact=True).click()
 await page.get_by_role('button',name='참가 중 · 채팅방 열기',exact=True).click()
 await page.get_by_role('button',name='AI 장소 추천',exact=True).click()
 await page.locator('.place-candidates .cand').first.wait_for(state='visible')
 await page.locator('.cand').first.get_by_role('button',name='이곳 어때요?',exact=True).click()
 assert '에서 만나면 어떨까요?' in await page.locator('#cin').input_value()
 await page.get_by_role('button',name='보내기',exact=True).click()
 assert await page.locator('#cin').input_value()==''
 assert await page.locator('#msgs').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
 composer=await bounds(page.locator('#composer'));head=await bounds(page.locator('#rhead'))
 assert abs(composer['x']-head['x'])<1
 if await page.locator('#toast.on').count():await page.locator('#toast.on').click()
 await page.screenshot(path=str(OUT/f'{engine}-{width}-chat.png'))
 await page.get_by_role('button',name='더보기',exact=True).click()
 await page.locator('#plusReveal').click()
 await page.get_by_role('button',name='만남 완료',exact=True).click()
 await page.locator('#ratewrap.on').wait_for(state='visible',timeout=12000)
 await page.get_by_role('button',name='나중에 할게요',exact=True).click()
 await page.wait_for_function('S.rooms[CUR].attended.size===roomTotal(CUR)',timeout=12000)
 await page.get_by_role('button',name='모임 사진첩',exact=True).click()
 await page.locator('#album.on').wait_for(state='visible')
 await page.get_by_role('button',name='홈',exact=True).click()
 assert await page.evaluate('Object.keys(S.met).length>2')
 # 새 모임 시트는 좁은 화면에서도 스크롤 끝의 제출 버튼에 접근한다.
 await page.get_by_role('button',name='매칭',exact=True).click()
 await page.get_by_role('button',name='새 모임 만들기',exact=True).click()
 await page.locator('#c-name').fill('정렬 확인 모임')
 await page.locator('#c-tags').get_by_role('button',name='러닝',exact=True).click()
 await page.locator('#c-btn').click()
 await page.wait_for_function('document.querySelector("#rname").textContent==="정렬 확인 모임"')
 # 시간·장소를 확정하지 않는 기존 흐름을 그대로 유지한다.
 await page.get_by_role('button',name='더보기',exact=True).click()
 await page.locator('#plusLeave').click()
 await page.locator('#cf-ok').click()
 await page.locator('#roomview').wait_for(state='hidden')

async def main():
 async with async_playwright() as p:
  for engine in ['chromium','webkit']:
   browser=await getattr(p,engine).launch()
   for width,height in [(320,812),(375,812),(599,812),(600,900),(768,1024),(1023,900),(1024,900),(1440,1000),(1920,1080),(812,375)]:
    page=await browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
    errors=[];external=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:external.append(r.url) if not r.url.startswith((ORIGIN+'/','data:')) else None)
    await page.goto(URL)
    await check_layout(page,width)
    if width in [375,1440]:
     await page.screenshot(path=str(OUT/f'{engine}-{width}-profile.png'))
     await flow(page,engine,width)
     await page.get_by_role('button',name='홈',exact=True).click()
     await page.screenshot(path=str(OUT/f'{engine}-{width}-home.png'))
    assert not errors,(engine,width,errors)
    assert not external,(engine,width,external)
    print(json.dumps({'engine':engine,'size':f'{width}×{height}','result':'정렬·넘침·터치 영역·하단 행동 검증 통과'},ensure_ascii=False),flush=True)
    await page.close()
   # 입장 화면은 외부 호출 없이 레이아웃만 확인한다.
   page=await browser.new_page(viewport={'width':375,'height':812},reduced_motion='reduce')
   await page.goto(URL);await page.evaluate('showEntry()')
   assert await page.locator('#entry').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
   await page.locator('#e-btn').scroll_into_view_if_needed()
   assert await page.locator('#e-btn').is_visible()
   await page.screenshot(path=str(OUT/f'{engine}-375-entry.png'))
   await browser.close()
asyncio.run(main())
