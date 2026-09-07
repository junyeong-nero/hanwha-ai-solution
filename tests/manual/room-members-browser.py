# 실행: python3 tests/manual/room-members-browser.py
# 독립 브라우저 두 개에서 실제 렌더링을 검사한다. Supabase 전송 계층만 모의 응답이다.
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

SETUP = r'''user => {
  ME=user;S.rooms={};S.joined=[];S.met={};CUR='qa-room';
  window.qa={members:[{user_id:'user-a',nickname:'첫 멤버'}],channels:[]};
  sb={
    rpc:async name=>({data:name==='room_members'?qa.members:[{
      meeting_id:CUR,title:'인원 동기화 확인',member_count:qa.members.length,unread_count:0
    }]}),
    from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return this},maybeSingle(){return this},
      then(resolve){return Promise.resolve({data:[]}).then(resolve)}}),
    channel:name=>{
      const ch={handlers:[],on(type,filter,callback){this.handlers.push({filter,callback});return this},subscribe(callback){this.status=callback;return this}};
      qa.channels.push(ch);return ch;
    },removeChannel:()=>{}
  };
  subscribeInbox();subscribeRoom(CUR);
  return syncVisibleRoom().then(()=>{$('roomview').classList.add('on')});
}'''

async def main():
    url=(Path(__file__).resolve().parents[2]/'src/index.html').as_uri()+'?demo=1'
    async with async_playwright() as p:
        browser=await p.chromium.launch()
        contexts=[await browser.new_context(viewport={'width':375,'height':812}) for _ in range(2)]
        pages=[await c.new_page() for c in contexts]
        errors=[]
        for page,user in zip(pages,['user-a','user-b']):
            page.on('pageerror',lambda e:errors.append(str(e)))
            await page.goto(url)
            await page.evaluate(SETUP,user)
        a,b=pages
        async def count(page,total):
            await page.wait_for_function('(n)=>document.querySelector("#memCount").textContent===String(n)',arg=total)
            assert await page.locator('#rmeta').inner_text()==f'멤버 {total} · 익명 {total-1}명'
        await count(a,1)
        for page in pages:
            await page.evaluate("qa.members.push({user_id:'user-b',nickname:'새 멤버'});qa.channels[0].handlers[0].callback({new:{meeting_id:CUR,sender_id:null}})")
            await count(page,2)
        await a.locator('#memCount').click()
        assert '멤버 2명 · 익명 1명' in await a.locator('#memsum').inner_text()
        await a.evaluate('hideMembers()')
        await a.evaluate("qa.members.pop();qa.channels[0].handlers[0].callback({new:{meeting_id:CUR,sender_id:null}})")
        await count(a,1)
        await a.evaluate("qa.members.push({user_id:'user-b',nickname:'새 멤버'});qa.channels[1].status('SUBSCRIBED')")
        await count(a,2)
        await a.screenshot(path='/tmp/issue-70-room-members.png')
        assert not errors,errors
        print(json.dumps({'viewport':'375×812','contexts':2,'flow':'참가 → 멤버 시트 → 탈퇴 → 재연결','pageerrors':errors,'backend':'모의 응답'},ensure_ascii=False))
        await browser.close()

asyncio.run(main())
