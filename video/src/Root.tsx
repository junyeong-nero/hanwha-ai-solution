import './index.css';
import {Composition, staticFile} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {MoonLight} from './MoonLight';

loadFont({family: 'Pretendard', url: staticFile('PretendardVariable.woff2'), weight: '45 920'});

export const RemotionRoot = () => <Composition id="MoonLightHanwha" component={MoonLight} durationInFrames={5550} fps={30} width={1920} height={1080}/>;
