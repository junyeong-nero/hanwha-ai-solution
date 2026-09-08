import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, staticFile} from 'remotion';
import {Audio} from '@remotion/media';
import {TransitionSeries} from '@remotion/transitions';
import {Background} from './Visuals';
import {Captions} from './Captions';
import {Problem} from './scenes/Problem';
import {Solution} from './scenes/Solution';
import {Discovery} from './scenes/Discovery';
import {Places} from './scenes/Places';
import {Connection} from './scenes/Connection';
import {Impact} from './scenes/Impact';

const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`;

export const MoonLight = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const chapter = frame < 900 ? 0 : frame < 1650 ? 1 : frame < 2700 ? 2 : frame < 4050 ? 3 : frame < 4800 ? 4 : 5;
  return <AbsoluteFill className="video-root">
    <Background/>
    <div className="brand"><span className="brand-moon"/>MoonLight <b>Hanwha</b></div>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={900} name="메인 화면과 문제 설명"><Problem/></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={750} name="AI 활용 사례 세 가지"><Solution/></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={1050} name="프로필과 모임 참가"><Discovery/></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={1350} name="AI 장소 추천과 스몰토크"><Places/></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={750} name="만남과 연결"><Connection/></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={750} name="효과와 파일럿"><Impact/></TransitionSeries.Sequence>
    </TransitionSeries>
    <Captions/>
    <div className="chapters"><div className="active"><small>{String(chapter + 1).padStart(2, '0')}</small>{['문제', 'AI 활용', '모임 발견', '대화와 장소', '만남과 연결', '기대효과'][chapter]}</div></div>
    <div className="timecode">{formatTime(frame / fps)} / {formatTime(durationInFrames / fps)}</div>
    <div style={{position: 'absolute', left: 0, bottom: 0, height: 4, width: `${frame / (durationInFrames - 1) * 100}%`, background: 'var(--orange)'}}/>
    <AbsoluteFill style={{background: 'var(--bg)', opacity: interpolate(frame, [0, 18, durationInFrames - 45, durationInFrames - 1], [1, 0, 0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), pointerEvents: 'none'}}/>
    <Audio src={staticFile('music.m4a')} volume={1}/>
    <Audio src={staticFile('effects.m4a')} volume={1}/>
  </AbsoluteFill>;
};
