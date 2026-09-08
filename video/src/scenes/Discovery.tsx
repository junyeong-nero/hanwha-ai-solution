import {Sequence} from 'remotion';
import {DetailImage, DemoFrame} from '../Visuals';

export const Discovery = () => <>
  <Sequence durationInFrames={360}>
    <DemoFrame clip="profile" step="시연 01 · 나를 알려주기" title={<>내 취향을,{ '\n' }만남의 시작으로.</>}>
      <div className="feature-list"><p><b>지역</b> 가까운 생활권에서</p><p><b>관심사</b> 함께 이야기할 주제로</p><p><b>관계 방향</b> 원하는 만남의 방식으로</p></div>
    </DemoFrame>
  </Sequence>
  <Sequence from={360} durationInFrames={420}>
    <DemoFrame clip="matching" step="시연 02 · 어울리는 모임 발견" title={<>모임을 살펴보고,{ '\n' }참가를 결정해요.</>}>
      <DetailImage src="matching-reason.png" height={230}/>
    </DemoFrame>
  </Sequence>
  <Sequence from={780} durationInFrames={270}>
    <DemoFrame clip="joining" step="시연 03 · 참가하면 채팅방으로" title={<>첫 대화는,{ '\n' }닉네임으로 가볍게.</>}>
      <div className="large-quote">“안녕하세요!<br/>같이 산책해요.”</div>
    </DemoFrame>
  </Sequence>
</>;
