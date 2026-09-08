import {Sequence, useCurrentFrame} from 'remotion';
import {Heading, Illustration, Reveal} from '../Visuals';

export const Problem = () => {
  const frame = useCurrentFrame();
  return <>
    <Sequence durationInFrames={150}>
      <div style={{position: 'absolute', left: 112, top: 216, width: 810}}>
        <Heading eyebrow="한화 신입사원 AI 솔루션 챌린지 · 자유주제" size={96}>달빛 아래,{ '\n' }하나의 한화.</Heading>
      </div>
    </Sequence>
    <Sequence from={150} durationInFrames={240}>
      <div style={{position: 'absolute', left: 112, top: 175, width: 810}}>
        <Heading eyebrow="문제 상황 · 입사 후 정착" size={78}>채용만큼 중요한,{ '\n' }입사 후 정착.</Heading>
        <Reveal delay={20}>
          <p style={{fontSize: 132, fontWeight: 800, color: 'var(--orange)', lineHeight: 1.2, marginTop: 40}}>16.1<span style={{fontSize: 67}}>%</span></p>
          <p style={{fontSize: 31, marginTop: 12}}>신규 입사자의 1년 내 퇴사율</p>
          <p style={{fontSize: 24, color: 'var(--tx3)', marginTop: 14}}>조사 기업 평균 · 신입·경력 포함</p>
        </Reveal>
      </div>
    </Sequence>
    <Sequence from={390} durationInFrames={210}>
      <div style={{position: 'absolute', left: 112, top: 175, width: 810}}>
        <Heading eyebrow="문제의 심각성 · 채용과 교육의 손실" size={78}>조기 퇴사가 남기는,{ '\n' }함께 감당할 손실.</Heading>
        <Reveal delay={14}>
          <p style={{fontSize: 100, fontWeight: 800, color: 'var(--orange)', lineHeight: 1.2, marginTop: 44}}>2천만원 <span style={{fontSize: 46}}>이상</span></p>
          <p style={{fontSize: 31, marginTop: 18}}>조기 퇴사 1인당 채용·교육 등 손실</p>
          <p style={{fontSize: 27, color: 'var(--tx2)', marginTop: 16}}>기업의 <b className="accent">75.6%</b>가 이렇게 답했습니다.</p>
        </Reveal>
      </div>
    </Sequence>
    <Sequence from={600} durationInFrames={300}>
      <div style={{position: 'absolute', left: 112, top: 205, width: 810}}>
        <Heading eyebrow="우리가 선택한 접근" size={78}>배치 후에도,{ '\n' }동료와 이어지도록.</Heading>
        <Reveal delay={20}><p style={{fontSize: 42, color: 'var(--orange-soft)', marginTop: 55}}>관계 형성 · 소속감</p>
          <p style={{fontSize: 30, color: 'var(--tx2)', marginTop: 28}}>한화 그룹사 신입사원의<br/>꾸준한 동기 교류를 돕습니다.</p>
        </Reveal>
      </div>
    </Sequence>
    <div style={{position: 'absolute', right: 112, top: 265}}><Reveal delay={10}><Illustration name="Cut 1" second="Cut 2" switchAt={600}/></Reveal></div>
    {frame >= 150 && <p style={{position: 'absolute', left: 112, top: 757, fontSize: 22, color: 'var(--tx3)'}}>
      {frame < 600 ? '고용노동부·한국고용정보원(2024) · 315개사 인사담당자 응답' : '관계와 이직 의향의 관련성 · 유승완 외(2025), Gallup(2024)'}
    </p>}
  </>;
};
