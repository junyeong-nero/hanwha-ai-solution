import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

URL = (Path(__file__).resolve().parents[2] / 'src/index.html').as_uri() + '?demo=1'


async def main():
    async with async_playwright() as p:
        for engine in ['chromium', 'webkit']:
            browser = await getattr(p, engine).launch()
            for width, height in [(375, 812), (599, 700), (600, 700), (768, 700), (1023, 768), (1024, 768), (1440, 1000)]:
                page = await browser.new_page(viewport={'width': width, 'height': height}, reduced_motion='reduce')
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                await page.goto(URL)
                await page.get_by_role('button', name='프로필', exact=True).click()
                await page.locator('#nick').fill('크레딧확인')
                link = page.get_by_role('button', name='크레딧', exact=True)
                dialog = page.get_by_role('dialog', name='크레딧', exact=True)
                await page.wait_for_timeout(100)
                # 끝 지점뿐 아니라 스크롤 중에도 본문이 내비게이션 뒤로 내려가지 않는다.
                for fraction in [0, .5, 1]:
                    await page.locator('#tab-profile').evaluate('(e,f)=>e.scrollTop=(e.scrollHeight-e.clientHeight)*f', fraction)
                    assert await page.evaluate('''()=>{
                        const pane=document.querySelector('#tab-profile').getBoundingClientRect();
                        const nav=document.querySelector('#nav').getBoundingClientRect();
                        const actions=document.querySelector('.profile-actions').getBoundingClientRect();
                        const limit=innerWidth<1024?nav.top:innerHeight;
                        return pane.bottom<=limit+1 && actions.bottom<=limit+1;
                    }'''), (engine, width, fraction)
                assert await link.evaluate('''e=>{
                    const r=e.getBoundingClientRect(), actions=document.querySelector('.profile-actions').getBoundingClientRect();
                    return r.top>=0 && r.bottom<=actions.top;
                }''')
                await link.scroll_into_view_if_needed()
                assert await link.evaluate('e=>e.getBoundingClientRect().height>=44')
                assert await link.evaluate("e=>e.previousElementSibling.id==='modehint' && e.nextElementSibling.classList.contains('profile-actions')")
                await page.screenshot(path=f'/tmp/profile-credits-footer-{engine}-{width}.png')
                for close in ['button', 'backdrop', 'Escape']:
                    await link.click()
                    assert await dialog.is_visible()
                    content = await dialog.inner_text()
                    for text in ['한화시스템 해양사업부 SW1팀', '2026년 9월 한화 인재경영원', '4팀 3파트', '송준영, 이수민, 이정현, 윤민영, 정태홍, 조성민']:
                        assert text in content
                    assert await page.locator('.credits-body').evaluate('e=>e.scrollWidth<=e.clientWidth && e.scrollHeight<=e.clientHeight')
                    email = dialog.get_by_role('link', name='junyeong.song@hanwha.com')
                    assert await email.get_attribute('href') == 'mailto:junyeong.song@hanwha.com'
                    assert await email.evaluate('e=>e.getBoundingClientRect().height>=44')
                    await page.keyboard.press('Tab')
                    assert await email.evaluate('e=>e===document.activeElement')
                    await page.keyboard.press('Tab')
                    assert await page.get_by_role('button', name='크레딧 닫기').evaluate('e=>e===document.activeElement')
                    for key in ['Tab', 'Shift+Tab']:
                        await page.keyboard.press(key)
                        assert await dialog.evaluate('e=>e.contains(document.activeElement)')
                    if close == 'button':
                        await page.screenshot(path=f'/tmp/profile-credits-sheet-{engine}-{width}.png')
                        await page.get_by_role('button', name='크레딧 닫기').click()
                    elif close == 'backdrop':
                        await page.mouse.click(3, 3)
                    else:
                        await page.keyboard.press('Escape')
                    assert not await dialog.is_visible()
                    assert await link.evaluate('e=>e===document.activeElement')
                    assert await page.locator('#nick').input_value() == '크레딧확인'
                assert not errors, errors
                print(f'{engine} {width}×{height}: 크레딧 내용·열기·닫기·포커스·설정 보존 통과')
                await page.close()
            await browser.close()


asyncio.run(main())
