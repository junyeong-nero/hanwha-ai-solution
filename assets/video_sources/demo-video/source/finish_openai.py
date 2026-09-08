"""OpenAI 내레이션을 장면에 맞추고 원본 녹화에서 새 MP4를 만든다."""
import json,pathlib,subprocess,wave,shutil,numpy as np
from PIL import Image,ImageDraw,ImageFont
out=pathlib.Path(__file__).resolve().parent.parent
source=out/'source';voices=source/'openai-voice'
timing=json.loads((source/'timing.json').read_text());meta=json.loads((voices/'metadata.json').read_text());total=timing['duration']
rate=48000;mix=np.zeros(int((total+1)*rate),np.float32);alignment=[]
for i,s in enumerate(meta):
 start=timing['timing'][i]['start'];end=timing['timing'][i+1]['start'] if i+1<len(meta) else total
 budget=end-start-.9;tempo=max(1,s['duration']/budget)
 assert tempo<1.12,(i,tempo)
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(voices/s['path']),'-af',f'atempo={tempo},loudnorm=I=-18:TP=-2:LRA=9','-f','f32le','-ar',str(rate),'-ac','1','-'])
 voice=np.frombuffer(raw,dtype=np.float32);position=int((start+.45)*rate)
 assert position+len(voice)<int((end-.2)*rate),(i,len(voice)/rate,end-start)
 mix[position:position+len(voice)]+=voice
 alignment.append(dict(index=i,start=position/rate,end=(position+len(voice))/rate,speed=tempo,text=s['text']))
# 기존 영상과 같은 배경음·장면 전환음.
t=np.arange(len(mix))/rate;music=np.zeros(len(mix),np.float32)
for j,chord in enumerate([(130.81,164.81,196),(110,130.81,164.81),(87.31,110,130.81),(98,123.47,146.83)]*5):
 start=j*6.4
 if start>=total:break
 u=t-start;env=np.where((u>=0)&(u<7),np.minimum(np.maximum(u,0)/1.2,1)*np.exp(-np.maximum(u-3.8,0)/1.2),0)
 for f in chord:music+=.005*env*np.sin(2*np.pi*f*t)
for start in [x['start'] for x in timing['timing']]:
 u=t-start;env=np.where((u>=0)&(u<.45),np.exp(-np.maximum(u,0)*15),0);music+=.018*env*np.sin(2*np.pi*784*t)
mix+=music;mix*=np.minimum(t/.35,1)*np.minimum(np.maximum(total-t,0)/1.3,1)
assert np.max(np.abs(mix))<1,'오디오 클리핑'
with wave.open(str(voices/'mix.wav'),'wb') as w:
 w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes((mix*32767).astype('<i2').tobytes())
# 영상 시청자가 합성 음성임을 알 수 있도록 짧게 표시한다.
label=Image.new('RGBA',(520,50),(0,0,0,0));draw=ImageDraw.Draw(label);font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',20)
draw.text((0,5),'AI 생성 음성 · OpenAI',font=font,fill='#929bb0');label.save(voices/'disclosure.png')
rawdur=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(source/'recording.webm')]))
output=out/'MoonLight_Hanwha_데모_소개_GPT음성.mp4'
subprocess.run(['ffmpeg','-y','-v','warning','-ss',str(max(0,rawdur-total)),'-i',str(source/'recording.webm'),'-i',str(voices/'mix.wav'),'-i',str(voices/'disclosure.png'),'-filter_complex',f'[0:v][2:v]overlay=100:120,fps=30,fade=t=in:st=0:d=0.3,fade=t=out:st={total-.8}:d=0.8[v]','-map','[v]','-map','1:a','-t',str(total),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(output)],check=True)
def stamp(sec):
 ms=int(sec*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
srt=[];rows=['# OpenAI 음성판 대본','', 'AI 생성 음성: gpt-4o-mini-tts · marin','', '| 시작 | 내레이션 |','| --- | --- |']
for s in alignment:
 sentences=[x.strip()+'.' for x in s['text'].split('.') if x.strip()];weight=sum(map(len,sentences));pos=s['start']
 for sentence in sentences:
  end=pos+(s['end']-s['start'])*len(sentence)/weight;srt.append(f'{len(srt)+1}\n{stamp(pos)} --> {stamp(end)}\n{sentence}\n');pos=end
 rows.append(f'| {stamp(s["start"])[:8]} | {s["text"]} |')
(out/'MoonLight_Hanwha_자막.srt').write_text('\n'.join(srt));(out/'대본.md').write_text('\n'.join(rows)+'\n')
(voices/'alignment.json').write_text(json.dumps({'model':'gpt-4o-mini-tts','voice':'marin','duration':total,'peak':float(np.max(np.abs(mix))),'scenes':alignment},ensure_ascii=False,indent=2))
original=out/'MoonLight_Hanwha_데모_소개.mp4';backup=source/'이전_시스템음성.mp4'
if not backup.exists():shutil.copy2(original,backup)
shutil.copy2(output,original)
print('OpenAI 음성판 완료:',output,flush=True)
