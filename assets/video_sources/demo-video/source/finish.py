import json,pathlib,subprocess,wave,numpy as np
out=pathlib.Path(__file__).resolve().parent.parent
scenes=json.loads((out/'source/scenes.json').read_text());timing=json.loads((out/'source/timing.json').read_text());total=timing['duration']
rate=48000;mix=np.zeros(int((total+1)*rate),np.float32)
for i,s in enumerate(scenes):
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(out/'source'/f'voice-{i:02}.aiff'),'-f','f32le','-ar',str(rate),'-ac','1','-'])
 voice=np.frombuffer(raw,dtype=np.float32);start=int((timing['timing'][i]['start']+.55)*rate)
 mix[start:start+len(voice)]+=voice*.95
# 직접 합성한 작은 음량의 배경음. 외부 음악 파일을 사용하지 않는다.
t=np.arange(len(mix))/rate
music=np.zeros(len(mix),np.float32)
for j,chord in enumerate([(130.81,164.81,196),(110,130.81,164.81),(87.31,110,130.81),(98,123.47,146.83)]*5):
 start=j*6.4
 if start>=total:break
 u=t-start;env=np.where((u>=0)&(u<7),np.minimum(np.maximum(u,0)/1.2,1)*np.exp(-np.maximum(u-3.8,0)/1.2),0)
 for f in chord:music+=.005*env*np.sin(2*np.pi*f*t)
for start in [x['start'] for x in timing['timing']]:
 u=t-start;env=np.where((u>=0)&(u<.45),np.exp(-np.maximum(u,0)*15),0)
 music+=.018*env*np.sin(2*np.pi*784*t)
mix+=music;mix*=np.minimum(t/0.6,1)*np.minimum(np.maximum(total-t,0)/1.5,1)
with wave.open(str(out/'source/mix.wav'),'wb') as w:
 w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
# 녹화 시작 전의 로딩 구간을 길이 차이로 제거한다.
rawdur=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(out/'source/recording.webm')]))
offset=max(0,rawdur-total)
cmd=['ffmpeg','-y','-v','warning','-ss',str(offset),'-i',str(out/'source/recording.webm'),'-i',str(out/'source/mix.wav'),'-t',str(total),'-vf',f'fps=30,fade=t=in:st=0:d=0.3,fade=t=out:st={total-0.8}:d=0.8','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(out/'MoonLight_Hanwha_데모_소개.mp4')]
subprocess.run(cmd,check=True)
def stamp(sec):
 ms=int(sec*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
srt=[]
for i,s in enumerate(scenes):
 st=timing['timing'][i]['start']+.55
 # 문장 단위로 나눠 플레이어 자막의 가독성을 높인다.
 sentences=[x.strip()+'.' for x in s['narration'].split('.') if x.strip()];weight=sum(map(len,sentences));pos=st
 for sentence in sentences:
  end=pos+s['voiceDuration']*len(sentence)/weight
  srt.append(f'{len(srt)+1}\n{stamp(pos)} --> {stamp(end)}\n{sentence}\n');pos=end
(out/'MoonLight_Hanwha_자막.srt').write_text('\n'.join(srt))
print('완성',total,'초',out/'MoonLight_Hanwha_데모_소개.mp4')
