import type {Caption} from '@remotion/captions';
import {useCurrentFrame} from 'remotion';
import captions from './captions.json';

export const Captions = () => {
  const frame = useCurrentFrame();
  const caption = (captions as Caption[]).find(c => c.startMs <= frame * 1000 / 30 && c.endMs > frame * 1000 / 30);
  if (!caption) return null;
  return <div className="captions"><div style={{width: 5, alignSelf: 'stretch', background: 'var(--orange)', borderRadius: 4}}/><div>{caption.text}</div></div>;
};
