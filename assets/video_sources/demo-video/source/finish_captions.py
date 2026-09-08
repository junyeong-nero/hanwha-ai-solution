"""음성 없이 핵심 설명 자막과 직접 합성한 배경음으로 소개 영상을 만든다."""
import json,pathlib,subprocess,shutil,wave,numpy as np
from PIL import Image,ImageDraw,ImageFont
out=pathlib.Path(__file__).resolve().parent.parent;source=out/'source';work=source/'captions';work.mkdir(exist_ok=True)
timing=json.loads((source/'timing.json').read_text());total=timing['duration'];fps=30
texts=[
['같은 한화, 아직 모르는 동료들.','취향이 맞는 동료를 발견하고\n대화에서 실제 만남으로 이어집니다.'],
['닉네임·선호 지역·관심사를 설정합니다.','원하는 관계 방향까지 고른 뒤 저장하면\n모임 추천에 반영됩니다.'],
['저장한 취향과 지역에 맞는 모임을 살펴보세요.','주황색 띠 = 모임 안에서 아는 사람의 비율\n익숙한 동료도, 새로운 인맥도 찾을 수 있어요.'],
['마음에 드는 모임에 참가하면\n내 채팅방이 바로 생깁니다.','처음 만나는 동료는 닉네임으로 표시됩니다.\n부담 없이 대화를 시작해 보세요.'],
['채팅방 ＋ → AI 추천 약속 잡기','대화를 바탕으로 장소·시간·활동과\n주변 식사까지 한 번에 제안합니다.'],
['지도와 목록에서 후보 위치·설명을 비교합니다.','마음에 드는 후보 → 이 장소로 정하기\n선택한 장소가 약속 카드에 반영됩니다.'],
['이 약속으로 확정 → 멤버별 동의 투표','모두 동의하면 약속이 확정됩니다.\n채팅방 상단에서 일정을 바로 확인하세요.'],
['이 장면은 실제 만남 이후를 가정합니다.','나와 상대가 모두 만남 완료를 누르면\n서로의 실명과 계열사가 공개됩니다.'],
['별점과 한 줄 코멘트로 만남을 평가합니다.','만남 후 사진첩도 열립니다.\n현재 시연 화면은 예시 사진첩입니다.'],
['만남이 새로운 동료와의 연결로 남습니다.','연결된 동료가 늘고, 새 계열사가 합류합니다.\n홈에서 넓어진 나의 우주를 확인하세요.'],
['취향으로 발견하고 · 대화로 가까워지고','만남으로 연결되는 사내 네트워킹\nMoonLight Hanwha']
]
font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',32)
blank=Image.new('RGBA',(1080,130),(0,0,0,0));blank.save(work/'blank.png')
segments=[];srt=[];manifest=[]
def stamp(sec):
 ms=round(sec*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
for i,pair in enumerate(texts):
 start=round(timing['timing'][i]['start']*fps);end=round((timing['timing'][i+1]['start'] if i+1<len(texts) else total)*fps)
 first=start+15;mid=round((start+end)/2)
 segments.append(('blank.png',first-start))
 for j,(text,a,b) in enumerate(zip(pair,[first,mid],[mid,end])):
  im=blank.copy();d=ImageDraw.Draw(im)
  d.rounded_rectangle((0,14,4,105),radius=2,fill='#F37321')
  for n,line in enumerate(text.split('\n')):
   assert d.textbbox((0,0),line,font=font)[2]<1020,('자막 넘침',line)
   d.text((27,17+n*47),line,font=font,fill='#CDD3E3')
  filename=f'{i:02}-{j}.png';im.save(work/filename);segments.append((filename,b-a))
  srt.append(f'{len(srt)+1}\n{stamp(a/fps)} --> {stamp(b/fps)}\n{text}\n');manifest.append(dict(scene=i,start=a/fps,end=b/fps,text=text))
concat=['ffconcat version 1.0']
for name,frames in segments:concat.extend([f"file '{name}'",'option framerate 30',f'duration {frames/fps:.9f}'])
concat.extend(["file 'blank.png'",'option framerate 30']);(work/'captions.ffconcat').write_text('\n'.join(concat)+'\n')
(work/'captions.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(out/'MoonLight_Hanwha_자막.srt').write_text('\n'.join(srt))
# TTS나 기존 오디오를 읽지 않는다. 배경음·전환음만 새로 합성한다.
rate=48000;t=np.arange(round(total*rate))/rate;music=np.zeros(len(t),np.float32)
for j,chord in enumerate([(130.81,164.81,196),(110,130.81,164.81),(87.31,110,130.81),(98,123.47,146.83)]*5):
 start=j*6.4
 if start>=total:break
 u=t-start;env=np.where((u>=0)&(u<7),np.minimum(np.maximum(u,0)/1.2,1)*np.exp(-np.maximum(u-3.8,0)/1.2),0)
 for f in chord:music+=.012*env*np.sin(2*np.pi*f*t)
for start in [x['start'] for x in timing['timing']]:
 u=t-start;env=np.where((u>=0)&(u<.45),np.exp(-np.maximum(u,0)*15),0);music+=.024*env*np.sin(2*np.pi*784*t)
music*=np.minimum(t/.5,1)*np.minimum(np.maximum(total-t,0)/1.5,1)
assert np.max(np.abs(music))<1
with wave.open(str(work/'music.wav'),'wb') as w:
 w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes((music*32767).astype('<i2').tobytes())
rawdur=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(source/'recording.webm')]))
output=out/'MoonLight_Hanwha_데모_소개_자막판.mp4'
subprocess.run(['ffmpeg','-y','-v','warning','-ss',str(max(0,rawdur-total)),'-i',str(source/'recording.webm'),'-i',str(work/'music.wav'),'-f','concat','-safe','0','-i',str(work/'captions.ffconcat'),'-filter_complex',f'[0:v][2:v]overlay=100:722:eof_action=pass,fps=30,fade=t=in:st=0:d=0.3,fade=t=out:st={total-.8}:d=0.8[v]','-map','[v]','-map','1:a','-t',str(total),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(output)],check=True)
shutil.copy2(output,out/'MoonLight_Hanwha_데모_소개.mp4')
rows=['# 자막판 화면 대본','', 'TTS 없음 · 화면에 설명 자막 표시 · 배경음만 사용','', '| 시작 | 화면 설명 |','| --- | --- |']
for m in manifest:rows.append(f'| {stamp(m["start"])[:8]} | '+m['text'].replace('\n',' / ')+' |')
(out/'대본.md').write_text('\n'.join(rows)+'\n')
print('자막판 완성:',output,'길이:',total,'자막 수:',len(manifest),flush=True)
