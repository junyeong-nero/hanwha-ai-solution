"""제출 MP4의 길이·규격·용량·디코딩·음량과 편집 원본의 타이밍을 검사한다."""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets/video.mp4'

def probe(file):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(file)]))

metadata = probe(path)
video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
assert (video['width'], video['height']) == (1920, 1080)
# JPEG 프레임을 사용한 Remotion 출력은 전체 범위 4:2:0으로 표시될 수 있다.
assert video['codec_name'] == 'h264' and video['pix_fmt'] in ('yuv420p', 'yuvj420p')
assert video['r_frame_rate'] == '30/1'
assert audio['codec_name'] == 'aac'
assert audio['channels'] == 2 and audio['sample_rate'] == '48000'
assert abs(float(metadata['format']['duration']) - 185) < .1
assert path.stat().st_size < 99614720, '파일당 95MiB 제출 제한 초과'

for name, duration in [('profile',12),('matching',14),('joining',9),('intent',12),('compare',16),('draft',9),('smalltalk',8),('reveal',25)]:
    clip = probe(ROOT / 'video/public' / (name + '.mp4'))
    assert abs(float(clip['format']['duration']) - duration) < .04, name

captions = json.loads((ROOT / 'video/src/captions.json').read_text())
for i, c in enumerate(captions):
    assert 0 <= c['startMs'] < c['endMs'] <= 185000
    assert c['endMs'] - c['startMs'] >= 3000
    assert i == 0 or captions[i-1]['endMs'] <= c['startMs']

decoded = subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','null','-'],capture_output=True,text=True)
assert decoded.returncode == 0 and not decoded.stderr, decoded.stderr
levels = subprocess.run(['ffmpeg','-hide_banner','-i',str(path),'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True).stderr
peak = float(re.search(r'max_volume: ([\d.-]+) dB',levels).group(1))
mean = float(re.search(r'mean_volume: ([\d.-]+) dB',levels).group(1))
assert -45 < peak < -1, f'배경음 음량 확인 필요: {peak} dB'
assert -34 < mean < -18, f'배경음 평균 음량 확인 필요: {mean} dB'

report = dict(file=str(path),duration=round(float(metadata['format']['duration']),3),resolution='1920×1080',fps=30,codec='H.264/AAC',pixelFormat=video['pix_fmt'],sizeMiB=round(path.stat().st_size/1024**2,2),captions=len(captions),audioPeakDb=peak,audioMeanDb=mean,audioChannels=audio['channels'],decodeErrors=0)
(ROOT / 'outputs/submission-video/verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
