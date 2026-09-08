"""환경변수의 OpenAI 키로 영상 내레이션을 생성한다. 키는 파일·로그에 기록하지 않는다."""
import concurrent.futures,json,os,pathlib,sys,urllib.request,urllib.error,subprocess,ssl,certifi
root=pathlib.Path(__file__).resolve().parent
texts=[
'같은 한화에 다니지만, 아직 모르는 동료들. 취향이 맞는 동료를 만나고, 새로운 인맥을 넓혀 보세요. 문라이트 한화입니다.',
'먼저 나를 설정합니다. 선호 지역과 관심사, 원하는 관계의 방향까지. 내 취향이 새로운 연결의 출발점이 됩니다.',
'저장한 설정에 맞는 모임을 살펴보세요. 주황색 띠는 아는 사람의 비율입니다. 익숙한 얼굴도, 새로운 동료도 찾을 수 있죠.',
'러닝 모임에 참가해 볼까요? 바로 채팅방으로 이어집니다. 처음 만나는 동료는 닉네임으로 보여, 편하게 대화를 시작할 수 있어요.',
'이제 약속을 잡아볼까요? 더보기에서 에이아이 추천 약속 잡기를 누르면, 대화를 바탕으로 장소와 시간, 활동까지 제안합니다.',
'후보 위치와 설명을 한눈에 비교해 보세요. 마음에 드는 장소를 고르면, 우리 모임의 약속 장소에 바로 반영됩니다.',
'이 약속으로 확정을 누르면 투표가 시작됩니다. 멤버 모두가 동의하면 약속이 확정되고, 채팅방 위에서 일정을 확인할 수 있어요.',
'이제 실제로 만났다고 가정해 볼게요. 나와 상대가 모두 만남 완료를 누르면, 서로의 이름과 계열사가 공개됩니다.',
'만남은 어땠나요? 별점으로 경험을 남기고, 새로 열린 사진첩에서 모임의 추억을 이어갑니다.',
'홈으로 돌아오면, 연결된 동료와 계열사가 늘어납니다. 만남이 쌓일수록 나의 우주도 함께 넓어집니다.',
'취향으로 발견하고, 대화로 가까워지고, 만남으로 연결되는 곳. 문라이트 한화입니다.'
]
folder=root/'openai-voice';folder.mkdir(exist_ok=True)
(folder/'script.json').write_text(json.dumps(texts,ensure_ascii=False,indent=2))
instructions='한국어 원어민의 자연스러운 표준 서울말로 읽어 주세요. 친근하고 세련된 앱 소개 영상의 내레이터입니다. 맑고 따뜻한 목소리, 편안한 대화체, 살짝 미소 띤 자신감 있는 톤으로 말하세요. 과장된 광고 연기나 뉴스 앵커처럼 딱딱한 낭독은 피하세요. 문장 사이에는 짧은 호흡을 두고, 문장 안에서는 단어를 끊지 말고 자연스럽게 연결하세요. 템포는 경쾌하되 서두르지 마세요. 모든 장면에서 음색과 말투를 일관되게 유지하세요. 입력 문장만 정확히 읽고 다른 말은 덧붙이지 마세요.'
def generate(i):
 p=folder/f'{i:02}.wav'
 if not p.exists():
  payload=dict(model='gpt-4o-mini-tts',voice='marin',input=texts[i],instructions=instructions,response_format='wav',speed=1.0)
  req=urllib.request.Request('https://api.openai.com/v1/audio/speech',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['OPENAI_API_KEY'],'Content-Type':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=120,context=ssl.create_default_context(cafile=certifi.where())) as res:data=res.read()
  except urllib.error.HTTPError as e:
   print('OpenAI TTS 요청 실패: HTTP',e.code,flush=True);raise RuntimeError('음성 생성 실패') from None
  p.write_bytes(data)
 duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
 print(f'장면 {i:02} 생성 완료: {duration:.2f}초',flush=True)
 return {'index':i,'duration':duration,'path':str(p.name),'text':texts[i]}
if __name__=='__main__':
 indices=[0] if '--sample' in sys.argv else range(len(texts))
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(generate,indices))
 if '--sample' not in sys.argv:(folder/'metadata.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
