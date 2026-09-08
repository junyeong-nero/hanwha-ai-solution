import React from 'react';
import {AbsoluteFill, CanvasImage, Easing, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Video} from '@remotion/media';

export const Reveal: React.FC<{children: React.ReactNode; delay?: number}> = ({children, delay = 0}) => {
  const frame = useCurrentFrame();
  return <div style={{opacity: interpolate(frame, [delay, delay + 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), translate: `0 ${interpolate(frame, [delay, delay + 26], [22, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(.2,.8,.2,1)})}px`}}>{children}</div>;
};

export const Background = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: 'var(--bg)', overflow: 'hidden'}}>
    <AbsoluteFill style={{background: 'radial-gradient(ellipse at 77% 37%, var(--card2), transparent 58%), radial-gradient(ellipse at 5% 90%, var(--orange-a12), transparent 52%)'}} />
    <svg width="1920" height="1080" style={{position: 'absolute', opacity: .5}}>
      {Array.from({length: 66}, (_, i) => <circle key={i} cx={(i * 331 + 79) % 1920} cy={(i * 173 + 33) % 1080} r={i % 7 === 0 ? 1.8 : .9} fill="var(--tx2)" opacity={.25 + .2 * Math.sin(frame / 60 + i)} />)}
    </svg>
    <div style={{position: 'absolute', width: 1250, height: 1250, left: 950, top: -90, rotate: `${frame / 100}deg`}}>
      {[1, .78, .55].map(s => <div key={s} style={{position: 'absolute', inset: `${(1-s)*50}%`, borderRadius: '50%', border: '1px solid var(--line2)'}} />)}
    </div>
  </AbsoluteFill>;
};

export const Orbit = ({linked = false}: {linked?: boolean}) => {
  const frame = useCurrentFrame();
  return <svg width="740" height="740" viewBox="0 0 740 740" aria-label="동료와 계열사의 연결을 표현한 궤도">
    <defs><radialGradient id="sun"><stop stopColor="var(--moon)"/><stop offset="1" stopColor="var(--orange)"/></radialGradient></defs>
    {[170,260,330].map(r => <circle key={r} cx="370" cy="370" r={r} stroke="var(--line2)" strokeWidth="1.5" fill="none"/>)}
    <circle cx="370" cy="370" r="66" fill="var(--orange-a12)"/>
    <circle cx="370" cy="370" r="48" fill="url(#sun)"/>
    <text x="370" y="378" fill="var(--bg)" fontSize="21" fontWeight="800" textAnchor="middle">한화</text>
    {Array.from({length: 8}, (_, i) => {
      const angle = i * 2.399 + frame / (i % 2 ? 720 : 950);
      const radius = [170,260,330][i % 3];
      const x = 370 + Math.cos(angle) * radius, y = 370 + Math.sin(angle) * radius;
      const active = linked || i < 2;
      return <g key={i}>
        {active && <line x1="370" y1="370" x2={x} y2={y} stroke="var(--orange-a30)" strokeWidth="2"/>}
        <circle cx={x} cy={y} r={active ? 23 : 17} fill={active ? 'var(--orange-a18)' : 'var(--card)'} stroke={active ? 'var(--orange)' : 'var(--line)'} strokeWidth="2"/>
        <circle cx={x} cy={y} r={active ? 8 : 5} fill={active ? 'var(--orange-soft)' : 'var(--tx3)'}/>
      </g>;
    })}
  </svg>;
};

export const Heading = ({eyebrow, children, size = 86}: {eyebrow: string; children: React.ReactNode; size?: number}) => <Reveal>
  <p className="eyebrow">{eyebrow}</p>
  <Interactive.H1 name={eyebrow} style={{fontSize: size, lineHeight: 1.18, fontWeight: 780, letterSpacing: '-.055em', margin: '24px 0 0', whiteSpace: 'pre-line'}}>{children}</Interactive.H1>
</Reveal>;

export const Phone = ({clip}: {clip: string}) => <div className="phone">
  <Video name="실제 앱 조작" src={staticFile(`${clip}.mp4`)} muted style={{width: '100%', height: '100%'}} />
</div>;

export const DemoFrame = ({clip, step, title, children}: {clip: string; step: string; title: React.ReactNode; children?: React.ReactNode}) => <>
  <div className="demo-copy"><Heading eyebrow={step}>{title}</Heading><div style={{marginTop: 48}}><Reveal delay={12}>{children}</Reveal></div></div>
  <Phone clip={clip}/>
  <div className="demo-label">실제 앱 조작 · 샘플 데이터</div>
</>;

export const DetailImage = ({src, height}: {src: string; height: number}) => <div style={{width: 930, height, overflow: 'hidden', borderRadius: 'var(--r-xl)', boxShadow: 'var(--sh-2)'}}>
  <CanvasImage src={staticFile(src)} style={{width: 930, height}} />
</div>;

export const Illustration = ({name, second, width = 840, switchAt = 150, dissolve = 24}: {name: string; second?: string; width?: number; switchAt?: number; dissolve?: number}) => {
  const frame = useCurrentFrame();
  return <div style={{width, height: width * 941 / 1672, overflow: 'hidden', borderRadius: 'var(--r-xl)', border: '1px solid var(--line2)', boxShadow: 'var(--sh-2)', position: 'relative'}}>
    <CanvasImage src={staticFile(`illusts/${name}.png`)} style={{position: 'absolute', width: '100%', height: '100%', scale: interpolate(frame, [0, 600], [1, 1.035], {extrapolateRight: 'clamp'})}}/>
    {second && <CanvasImage src={staticFile(`illusts/${second}.png`)} style={{position: 'absolute', width: '100%', height: '100%', opacity: interpolate(frame, [switchAt, switchAt + dissolve], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), scale: interpolate(frame, [0, 600], [1, 1.035], {extrapolateRight: 'clamp'})}}/>}
  </div>;
};
