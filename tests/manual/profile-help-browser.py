import asyncio,json,os
from playwright.async_api import async_playwright
# 별도 서버를 실행한 뒤 PROFILE_HELP_URL로 주소를 지정할 수 있다.
URL=os.environ.get('PROFILE_HELP_URL','http://127.0.0.1:8873/src/?demo=1')
async def main():
 async with async_playwright() as p:
  for engine in ['chromium','webkit']:
   browser=await getattr(p,engine).launch()
   for width,height in [(320,812),(375,812),(1440,1000)]:
    page=await browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.goto(URL)
    await page.get_by_role('button',name='프로필',exact=True).click()
    assert await page.locator('#profileIntro').is_visible()
    assert await page.locator('#f-region').evaluate('(e)=>e.getBoundingClientRect().bottom') < height
    await page.screenshot(path=f'/tmp/profile-help-{engine}-{width}.png')
    # 최대 길이 닉네임과 안내가 작은 화면에서도 잘리거나 겹치지 않는다.
    await page.locator('#nick').fill('가나다라마바사아')
    assert await page.locator('#nick').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    assert await page.locator('.pfhead small').evaluate('''e=>{
     const range=document.createRange();range.selectNodeContents(e);
     const box=e.getBoundingClientRect();
     return getComputedStyle(e).wordBreak==='keep-all' && [...range.getClientRects()].every(r=>r.left>=box.left && r.right<=box.right+1);
    }''')
    assert await page.locator('.pfhero').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    await page.screenshot(path=f'/tmp/profile-copy-{engine}-{width}.png')
    await page.locator('#nick').fill('가이드검증')
    help=page.get_by_role('button',name='도움말',exact=True)
    await help.click()
    assert await page.get_by_role('dialog').is_visible()
    if width==375:assert await page.locator('#usageGuide .sbody').evaluate('(e)=>e.scrollHeight>e.clientHeight')
    await page.screenshot(path=f'/tmp/profile-help-sheet-{engine}-{width}.png')
    for _ in range(4):
     await page.keyboard.press('Tab')
     assert await page.evaluate("document.querySelector('#usageGuide').contains(document.activeElement)")
    await page.keyboard.press('Escape')
    assert not await page.get_by_role('dialog').is_visible()
    assert await help.evaluate('(e)=>e===document.activeElement')
    assert await page.locator('#nick').input_value()=='가이드검증'
    await help.click();await page.get_by_role('button',name='도움말 닫기').click()
    assert await help.evaluate('(e)=>e===document.activeElement')
    await help.click();await page.mouse.click(3,3)
    assert not await page.get_by_role('dialog').is_visible()
    await page.get_by_role('button',name='이 설정으로 모임 둘러보기',exact=True).click()
    await page.get_by_role('button',name='프로필',exact=True).click()
    assert not await page.locator('#profileIntro').is_visible()
    await page.reload();await page.get_by_role('button',name='프로필',exact=True).click()
    assert not await page.locator('#profileIntro').is_visible()
    await page.get_by_role('button',name='홈',exact=True).click()
    entry=page.get_by_role('button',name='처음이신가요? 사용 가이드',exact=True)
    await entry.click();await page.get_by_role('button',name='도움말 닫기').click()
    assert await page.locator('#tab-home').evaluate("e=>e.classList.contains('on')")
    assert await entry.evaluate('(e)=>e===document.activeElement')
    assert not errors,errors
    print(json.dumps({'engine':engine,'width':width,'flow':'입력 우선·도움말·포커스·입력 유지·완료 후 숨김·재접속·홈 복귀 통과','errors':errors},ensure_ascii=False))
    await page.close()
   await browser.close()
asyncio.run(main())
