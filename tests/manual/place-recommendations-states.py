# 사전 준비: python3 -m pip install playwright && python3 -m playwright install chromium webkit
# 저장소 루트에서 python3 -m http.server 8766 --bind 127.0.0.1 실행 후 이 스크립트를 실행한다.
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
async def main():
 async with async_playwright() as p:
  browser=await p.webkit.launch()
  for width in [320,375,768,1440]:
   page=await browser.new_page(viewport={'width':width,'height':900},reduced_motion='reduce')
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   # 백엔드 응답 모양만 주입한다. 운영 인증·AI·카카오 API는 호출하지 않는다.
   config=(ROOT/'src/js/config.js').read_text().replace("KAKAO_JS_KEY:''","KAKAO_JS_KEY:'test-key'")
   await page.route('**/js/config.js',lambda r:r.fulfill(body=config,content_type='application/javascript'))
   await page.route('https://dapi.kakao.com/**',lambda r:r.abort())
   await page.route('**/js/boot.js',lambda r:r.fulfill(content_type='application/javascript',body="""
    bindChipEvents();ME='test-user';S.tab='chat';$('tab-home').classList.remove('on');$('tab-chat').classList.add('on');CUR='m1';S.joined=['m1'];ensureRoom('m1');
    $('roomview').classList.add('on');renderMeta('m1');renderMsgs();renderBanner();
    globalThis.testMode='ok';globalThis.testCount=0;
    callFn=async()=>{testCount++;await new Promise(r=>setTimeout(r,150));
      if(testMode==='fail')throw Error('장소 검색에 연결하지 못했어요. 다시 시도해 주세요');
      if(testMode==='empty')return {plan:null,search:{status:'empty'}};
      return {plan:{id:'test-'+testCount,recommendation_only:true,candidates:Array.from({length:5},(_,i)=>({name:'검증용 장소 후보 '+(i+1),address:'경기 성남시 분당구 판교역로 테스트 주소',category:i%2?'카페':'음식점',why:i%2?'대화에서 식사 후 차를 마시자는 의견이 있어, 같은 지역에서 검색한 카페를 후보에 넣었어요.':'대화에서 원한 음식점 업종과 모임 지역이 맞는 후보예요. 운영 여부는 상세에서 확인해 주세요.',lat:37.39+i*.003,lng:127.1+i*.004,url:'https://place.map.kakao.com/test-'+i}))}};
    };
   """))
   await page.goto('http://127.0.0.1:8766/src/')
   await page.get_by_role('button',name='AI 장소 추천',exact=True).click()
   await page.locator('.cand').nth(4).wait_for()
   await page.locator('.planmap.ph').wait_for()
   assert await page.locator('.cand .detail').count()==5
   await page.locator('.cand .pick').nth(2).press('Enter')
   assert await page.locator('.cand .pick').nth(2).get_attribute('aria-pressed')=='true'
   assert await page.locator('.planmap .pin').nth(2).get_attribute('aria-pressed')=='true'
   overflow=await page.evaluate('''() => [...document.querySelectorAll('.place-plan,.cand,#composer,#rbanner')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||e.scrollWidth>e.clientWidth+1}).map(e=>e.className||e.id)''')
   assert not overflow,overflow
   await page.evaluate("testMode='fail'")
   await page.get_by_role('button',name='AI 장소 추천',exact=True).click()
   await page.get_by_role('button',name='다시 추천받기',exact=True).wait_for()
   assert await page.locator('.cand').count()==5
   await page.evaluate("testMode='empty'")
   await page.get_by_role('button',name='다시 추천받기',exact=True).click()
   await page.get_by_text('검색 결과가 없어',exact=False).wait_for()
   assert await page.locator('.cand').count()==5
   await page.evaluate("testMode='ok'")
   await page.get_by_role('button',name='다시 추천받기',exact=True).click()
   await page.locator('.previous-places').wait_for()
   assert not errors,errors
   print(json.dumps({'width':width,'backend':'모의 응답','SDK':'실패 후 상대 위치 지도','candidates':5,'keyboard_selection':'정상','retry':'정상','overflow':overflow,'errors':errors},ensure_ascii=False))
   await page.close()
  await browser.close()
asyncio.run(main())
