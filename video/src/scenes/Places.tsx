import {Sequence} from 'remotion';
import {DetailImage, DemoFrame} from '../Visuals';

export const Places = () => <>
  <Sequence durationInFrames={360}>
    <DemoFrame clip="intent" step="시연 04 · 대화에서 장소로" title={<>어디서 만날지,{ '\n' }우리 대화에 힌트가.</>}>
      <div className="large-quote">“산책 끝나고<br/><span className="accent">닭발</span> 먹을까요?”</div>
    </DemoFrame>
  </Sequence>
  <Sequence from={360} durationInFrames={480}>
    <DemoFrame clip="compare" step="시연 05 · 후보와 추천 이유 비교" title={<>이 장소를,{ '\n' }추천한 이유까지.</>}>
      <DetailImage src="place-reason-detail.png" height={222}/>
    </DemoFrame>
  </Sequence>
  <Sequence from={840} durationInFrames={270}>
    <DemoFrame clip="draft" step="시연 06 · 제안은 대화로 이어지게" title={<>“이곳 어때요?”{ '\n' }내 의견으로 보내요.</>}>
      <div className="decision-steps"><span>후보 선택</span><span>→</span><span>초안 확인</span><span>→</span><b>직접 전송</b></div>
    </DemoFrame>
  </Sequence>
  <Sequence from={1110} durationInFrames={240}>
    <DemoFrame clip="smalltalk" step="시연 07 · AI 스몰토크" title={<>대화가 멈추면,{ '\n' }다음 질문을 건네요.</>}>
      <div className="large-quote">“러닝에 관심 갖게 된<br/>계기가 있어요?”</div>
    </DemoFrame>
  </Sequence>
</>;
