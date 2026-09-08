"""3분 5초 영상용 잔잔한 배경음과 화면에 맞춘 효과음을 직접 합성한다."""
import json
import pathlib
import subprocess
import wave

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'video/public'
WORK = ROOT / 'outputs/submission-video/audio'
RATE, DURATION = 48000, 185
WORK.mkdir(parents=True, exist_ok=True)


def add(track, signal, start, gain=1, pan=0):
    offset = round(start * RATE)
    count = min(len(signal), len(track) - offset)
    assert offset >= 0 and count > 0
    track[offset:offset + count] += signal[:count, None] * gain * np.sqrt([(1-pan)/2, (1+pan)/2])


def tone(midi, seconds, soft=False):
    t = np.arange(round(seconds * RATE), dtype=np.float32) / RATE
    frequency = 440 * 2 ** ((midi - 69) / 12)
    if soft:
        envelope = np.minimum(t / 1.1, 1) * np.minimum((seconds-t) / 1.8, 1)
        signal = .5 * (np.sin(2*np.pi*(frequency-.12)*t) + np.sin(2*np.pi*(frequency+.12)*t))
        signal += .1 * np.sin(2*np.pi*frequency*2*t)
    else:
        envelope = (1-np.exp(-t/.012)) * np.exp(-t/1.25) * np.minimum((seconds-t)/.25, 1)
        signal = sum(gain*np.sin(2*np.pi*frequency*partial*t) for partial,gain in [(1,1),(2,.25),(3,.065),(4,.02)])
    return (signal * envelope).astype(np.float32)


def finish(track, name):
    t = np.arange(len(track), dtype=np.float32) / RATE
    track *= (np.minimum(t/2.5, 1) * np.minimum((DURATION-t)/4, 1))[:, None]
    assert np.isfinite(track).all() and np.max(np.abs(track)) < .5
    path = WORK / (name + '.wav')
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes((track * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(path),'-c:a','aac','-b:a','192k','-movflags','+faststart',str(PUBLIC / (name + '.m4a'))],check=True)


# 72 BPM, Dmaj9 → Bm7 → Gmaj9 → Asus2. 건반·패드만으로 여백을 남긴다.
music = np.zeros((RATE * DURATION, 2), dtype=np.float32)
chords = [(50,57,61,66,69),(47,54,57,62,66),(43,50,54,57,62),(45,52,57,59,64)]
beat = 60 / 72
for bar in range(27):
    start = bar * 8 * beat
    chord = chords[bar % 4]
    for index, note in enumerate(chord):
        add(music, tone(note, 8*beat+1.5, soft=True), start, .034, (index-2)*.22)
    for index, (position, voice) in enumerate([(0,2),(1.5,3),(3,4),(4.5,3),(6,1)]):
        add(music, tone(chord[voice]+12, 4), start+position*beat, .06 if index in (0,3) else .045, (-1)**index*.32)
    for position in (0,4):
        add(music, tone(chord[0]-12, 3.5), start+position*beat, .038)

# 마지막 브랜드 화면은 으뜸화음으로 마무리한다.
for index, note in enumerate(chords[0]):
    add(music, tone(note, 7, soft=True), 178, .035, (index-2)*.2)
    add(music, tone(note+12, 5), 179+index*.1, .027, (index-2)*.15)
dry = music.copy()
for delay, gain in [(.23,.16),(.41,.1),(.67,.06)]:
    samples = round(delay * RATE)
    music[samples:] += dry[:-samples, ::-1] * gain
del dry
music *= min(.05 / np.sqrt(np.mean(music**2)), .18 / np.max(np.abs(music)))
# 시연 설명 구간은 조금 낮추고, 기대효과·마무리에서 원래 음량으로 돌아온다.
t = np.arange(len(music), dtype=np.float32) / RATE
music *= np.interp(t, [0,53,55,158,160,185], [1,1,.8,.8,1,1])[:,None]
finish(music, 'music')

# 전환은 짧은 공기음, 조작은 둥근 탭, 연결은 따뜻한 차임으로 구분한다.
effects = np.zeros_like(music)
rng = np.random.default_rng(20260908)
whoosh_t = np.arange(round(.65*RATE), dtype=np.float32)/RATE
noise = np.convolve(rng.standard_normal(len(whoosh_t)), np.ones(36)/36, mode='same')
whoosh = noise*np.sin(np.pi*whoosh_t/.65)**2
whoosh *= .04 / np.max(np.abs(whoosh))
tap_t = np.arange(round(.16*RATE), dtype=np.float32)/RATE
tap = np.sin(2*np.pi*(420*tap_t-650*tap_t**2)) * (1-np.exp(-tap_t/.004))*np.exp(-tap_t/ .027)

cues = [(x,'전환') for x in (30,55,67,90,102,135,160,179)] + [
    (20.1,'연결'), (65.2,'탭'), (81.4,'참가'), (96.4,'탭'),
    (99.3,'후보'), (118.4,'탭'), (121.2,'전송'), (130.2,'후보'),
    (138.6,'공개'), (141.05,'건배'), (145.0,'연결'), (151.4,'연결'),
]
for start, kind in cues:
    if kind == '전환':
        add(effects, whoosh, start-.12)
    elif kind == '탭':
        add(effects, tap, start, .13)
    elif kind == '건배':
        for delay, midi in [(0,86),(.08,93)]:
            add(effects, tone(midi,1.4),start+delay,.062, -.15 if delay == 0 else .15)
    else:
        notes = [74,81,86] if kind in ('연결','공개') else [74,78]
        for index, midi in enumerate(notes):
            add(effects,tone(midi,2.4),start+index*.13,.1 if kind == '연결' else .078,(index-1)*.15)
finish(effects, 'effects')

assert len(cues) == 20 and all(0 <= start < DURATION-2 for start,_ in cues)
mixed = music + effects
assert np.max(np.abs(mixed)) < .5, '믹스 피크에 여유가 필요합니다.'
for start in range(5,DURATION-5,5):
    assert np.sqrt(np.mean(music[start*RATE:(start+1)*RATE]**2)) > .008, f'{start}초 배경음 누락'
report = dict(duration=DURATION,sampleRate=RATE,channels=2,bpm=72,
    musicRmsDb=round(float(20*np.log10(np.sqrt(np.mean(music**2)))),2),
    mixPeakDb=round(float(20*np.log10(np.max(np.abs(mixed)))),2),
    cues=[dict(time=start,event=kind) for start,kind in sorted(cues)],
    source='직접 합성한 건반·패드와 효과음, 외부 음원 없음')
(WORK / 'soundtrack.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
