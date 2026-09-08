import {useCurrentFrame} from 'remotion';
import {DemoFrame, Illustration} from '../Visuals';

export const Connection = () => {
  const frame = useCurrentFrame();
  return <DemoFrame clip="reveal" step="시연 08 · 실제 만남 이후를 가정" title={frame < 450 ? <>서로 만나면,{ '\n' }베일이 벗겨집니다.</> : <>한 번의 만남이,{ '\n' }내 우주를 넓힙니다.</>}>
    {frame < 450 ? <div style={{display: 'flex', gap: 34, alignItems: 'center'}}>
      <Illustration name="Cut 3(1)" second="Cut 3(2)" width={535} switchAt={180} dissolve={8}/>
      <p style={{fontSize: 39, fontWeight: 700, color: 'var(--orange-soft)'}}>서로의 실명과<br/>계열사 공개</p>
    </div> : <>
      <div className="connection-result"><div><p>연결된 동료</p><b>2 <span>→</span> 4<span>명</span></b></div><div><p>빛나는 행성</p><b>2 <span>→</span> 3<span>곳</span></b></div></div>
    </>}
  </DemoFrame>;
};
