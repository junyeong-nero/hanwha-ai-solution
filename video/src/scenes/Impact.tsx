import {Sequence} from 'remotion';
import {Heading, Illustration, Orbit, Reveal} from '../Visuals';

const Closing = () => <>
  <div style={{position: 'absolute', right: -90, top: 125, opacity: .65}}><Orbit linked/></div>
  <div style={{position: 'absolute', left: 112, top: 250}}>
    <Heading eyebrow="MoonLight Hanwha" size={96}>오늘의 산책 친구가,{ '\n' }내일의 협업 동료로.</Heading>
    <Reveal delay={20}><p style={{fontSize: 39, color: 'var(--tx2)', marginTop: 38}}>취향으로 발견하고 · 대화로 가까워지고 · 만남으로 연결됩니다.</p></Reveal>
    <Reveal delay={38}><div style={{fontSize: 27, color: 'var(--orange-soft)', marginTop: 48}}>앱 체험 · junyeong-nero.github.io/hanwha-ai-solution/?demo=1</div></Reveal>
  </div>
</>;

export const Impact = () => <>
  <Sequence durationInFrames={270}>
    <div style={{position: 'absolute', left: 112, top: 190, width: 800}}>
      <Heading eyebrow="기대하는 변화" size={82}>관계의 시작을,{ '\n' }일상 속으로.</Heading>
      <Reveal delay={20}><div style={{fontSize: 37, lineHeight: 1.9, marginTop: 42}}>새로운 동료 발견<br/>첫 대화의 부담 완화<br/><span className="accent">계열사 간 교류 확대</span></div></Reveal>
    </div>
    <div style={{position: 'absolute', right: 112, top: 260}}><Reveal delay={10}><Illustration name="Cut 4"/></Reveal></div>
  </Sequence>
  <Sequence from={270} durationInFrames={300}>
    <div style={{padding: '170px 112px 0'}}>
      <Heading eyebrow="앞으로의 계획" size={82}>작게 시작하고,{ '\n' }함께 개선하겠습니다.</Heading>
      <div className="impact-grid">
        <Reveal delay={14}><div><p className="eyebrow">시범 운영</p><h2>교육 동기부터<br/>함께 사용</h2></div></Reveal>
        <Reveal delay={28}><div><p className="eyebrow">변화 확인</p><h2>참가 · 만남 완료<br/>새로운 연결</h2></div></Reveal>
        <Reveal delay={42}><div><p className="eyebrow">사용자 의견</p><h2>재참여 · 만족도<br/>다음 개선에 반영</h2></div></Reveal>
      </div>
    </div>
  </Sequence>
  <Sequence from={570} durationInFrames={180}><Closing/></Sequence>
</>;
