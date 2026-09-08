import {useCurrentFrame} from 'remotion';
import {Heading, Reveal} from '../Visuals';

export const Solution = () => {
  const frame = useCurrentFrame();
  const active = frame < 240 ? 0 : frame < 480 ? 1 : 2;
  return <div style={{padding: '170px 112px 0'}}>
    <Heading eyebrow="AI 활용 사례 · 3가지" size={78}>만남의 세 순간을, <span className="accent">AI가 돕습니다.</span></Heading>
    <div style={{display: 'flex', gap: 28, marginTop: 80}}>
      {[
        ['AI 매칭', 'GPT-5.4-mini API 사용', '나와 어울리는 모임'],
        ['만남 장소 추천', '채팅 기록 기반', '함께 만나기 좋은 장소'],
        ['스몰토크 주제 추천', '채팅 기록 기반', '자연스럽게 이어갈 질문'],
      ].map(([title, label, result], i) => <Reveal key={title} delay={16+i*10}>
        <div style={{width: 547, padding: '34px 28px', borderRadius: 'var(--r-xl)', border: `2px solid ${active === i ? 'var(--orange)' : 'var(--line2)'}`, background: active === i ? 'var(--orange-a12)' : 'var(--bg2)'}}>
          <p style={{fontSize: 26, color: 'var(--orange-soft)'}}>0{i+1}</p>
          <h2 style={{fontSize: 42, fontWeight: 700, marginTop: 18, whiteSpace: 'nowrap'}}>{title}</h2>
          <p style={{fontSize: 27, color: 'var(--orange-soft)', marginTop: 16}}>{label}</p>
          <p style={{fontSize: 31, color: 'var(--tx2)', marginTop: 48}}>{result}</p>
        </div>
      </Reveal>)}
    </div>
  </div>;
};
