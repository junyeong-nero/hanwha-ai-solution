const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url).pathname;
const scenes=JSON.parse(await fs.readFile(root+'source/scenes.json','utf8'));
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,recordVideo:{dir:root+'source/raw',size:{width:1920,height:1080}}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8048/outputs/demo-video/source/stage.html');
const app=page.frames().find(f=>f.url().includes('/src/'));
await app.locator('#spacestats').waitFor();await page.evaluate(()=>document.fonts.ready);
const delay=ms=>page.waitForTimeout(ms);
const click=async locator=>{await locator.scrollIntoViewIfNeeded();await delay(250);await locator.click();};
const nav=name=>click(app.getByRole('button',{name,exact:true}));
const actions=[
async()=>{},
async()=>{await nav('프로필');await delay(1200);await app.locator('#nick').fill('달빛러너');await delay(1100);await app.locator('#f-dir').scrollIntoViewIfNeeded();await delay(1700);await click(app.locator('#saveBtn'));await delay(500);await app.locator('#tab-profile').evaluate(el=>el.scrollTo({top:0,behavior:'smooth'}));},
async()=>{await nav('매칭');await app.locator('[onclick="joinMeet(\'m1\')"]').waitFor();await app.locator('[onclick="joinMeet(\'m1\')"]').scrollIntoViewIfNeeded();},
async()=>{await click(app.locator('[onclick="joinMeet(\'m1\')"]'));await delay(1500);await click(app.locator('[onclick="openJoined(\'m1\')"]'));await delay(1500);await app.locator('#cin').pressSequentially('목요일 저녁에 가볍게 달려요!',{delay:65});await click(app.getByRole('button',{name:'보내기',exact:true}));},
async()=>{await nav('더보기');await delay(1500);await click(app.locator('[onclick="aiPlan()"]'));await app.locator('.aimsg').waitFor();await delay(500);await app.locator('.aimsg').evaluate(el=>el.scrollIntoView({block:'start',behavior:'smooth'}));},
async()=>{await app.locator('.cands').evaluate(el=>el.scrollIntoView({block:'start',behavior:'smooth'}));await delay(1800);await click(app.locator('.cands button').filter({hasText:'2판교 중앙공원'}));await delay(1000);await click(app.getByRole('button',{name:'이 장소로 정하기',exact:true}));await delay(900);await app.locator('.cands').evaluate(el=>el.scrollIntoView({block:'start',behavior:'smooth'}));},
async()=>{await click(app.getByRole('button',{name:'이 약속으로 확정',exact:true}));await app.getByRole('button',{name:'만남 완료',exact:true}).waitFor({timeout:10000});},
async()=>{await delay(2200);await nav('만남 완료');await app.locator('#ratewrap.on').waitFor();await delay(1000);await click(app.getByRole('button',{name:'5점',exact:true}));},
async()=>{await app.locator('#ratecmt').fill('편하게 이야기하고 함께 달려서 좋았어요');await delay(900);await click(app.locator('#ratebtn'));await delay(900);await nav('채팅방 멤버 보기');await delay(2300);await click(app.locator('button[onclick="hideMembers()"]'));await nav('모임 사진첩');},
async()=>{await nav('홈');await app.locator('#space').waitFor();await delay(1500);await app.locator('#tab-home').evaluate(el=>el.scrollTo({top:360,behavior:'smooth'}));},
async()=>{}
];
const timing=[];const start=Date.now();
for(let i=0;i<scenes.length;i++){
 const t=Date.now();timing.push({index:i,start:(t-start)/1000});
 await page.evaluate(({s,i,n})=>window.scene(s,i,n),{s:scenes[i],i,n:scenes.length});
 await actions[i]();
 await delay(400);await page.screenshot({path:root+`source/scene-${String(i).padStart(2,'0')}.png`});
 const remaining=scenes[i].duration*1000-(Date.now()-t);if(remaining<0)throw Error('장면 시간 초과 '+i+' '+remaining);
 await page.evaluate(({duration,start,total})=>{let p=document.querySelector('#progress');p.style.width=(start/total*100)+'%';p.animate([{width:(start/total*100)+'%'},{width:((start+duration)/total*100)+'%'}],{duration:duration*1000,fill:'forwards'});},{duration:remaining/1000,start:(Date.now()-start)/1000,total:scenes.reduce((a,s)=>a+s.duration,0)});
 console.log('장면 완료',i,'남은 표시 시간',Math.round(remaining/1000));await delay(remaining);
}
await fs.writeFile(root+'source/timing.json',JSON.stringify({timing,errors,duration:(Date.now()-start)/1000},null,2));
const video=page.video();await context.close();await video.saveAs(root+'source/recording.webm');await browser.close();
console.log('녹화 완료',errors);
