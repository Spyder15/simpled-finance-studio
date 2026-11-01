import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import { CoinStack, GROUND, Person } from './Short';

export const FPS = 30;
export const GAP = 0.4;

export type Tone = 'gold' | 'red' | 'green';
export type SceneData = {
  type: 'talk' | 'coins' | 'compare' | 'list' | 'outro';
  speaker: 'rahul' | 'dada';
  mood?: 'happy' | 'worried' | 'shock';
  audio: string;
  seconds: number;
  headline: string;
  narration: string;
  size?: number;
  tone?: Tone;
  label?: string;
  a?: { label: string; size: number; tone: Tone };
  b?: { label: string; size: number; tone: Tone };
  items?: string[];
};
export type StoryProps = { orientation: 'portrait' | 'landscape'; scenes: SceneData[]; handle: string; disclaimer: string };

export const defaultStory: StoryProps = {
  orientation: 'portrait',
  handle: '@SimpledFinance',
  disclaimer: 'Sirf educational jaankari, financial salah nahi.',
  scenes: [{ type: 'talk', speaker: 'rahul', audio: '', seconds: 3, headline: 'Demo', narration: 'Demo' }]
};

export const storyFrames = (props: StoryProps) => props.scenes.reduce((sum, s) => sum + Math.round((s.seconds + GAP) * FPS), 0);
export const storySize = (o: StoryProps['orientation']) => (o === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

const FONT = '"Noto Sans Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", "Helvetica Neue", Arial, sans-serif';
const COLORS: Record<Tone, { c: string; e: string }> = {
  gold: { c: '#ffc233', e: '#ff9f00' },
  red: { c: '#ff4040', e: '#d90429' },
  green: { c: '#38d39f', e: '#10b981' }
};
const ease = (frame: number, start: number, dur: number) => {
  const t = Math.min(1, Math.max(0, (frame - start) / dur));
  return 1 - Math.pow(1 - t, 3);
};
const pop = (frame: number, start = 0) => spring({ frame: frame - start, fps: FPS, config: { damping: 14 } });

type Layout = { portrait: boolean; W: number; H: number; px: number; ox: number; k: number; z: number; fov: number };
const layoutFor = (o: StoryProps['orientation']): Layout =>
  o === 'portrait'
    ? { portrait: true, W: 1080, H: 1920, px: -1.9, ox: 1.3, k: 1, z: 14, fov: 42 }
    : { portrait: false, W: 1920, H: 1080, px: -4.2, ox: 3.2, k: 0.6, z: 13.5, fov: 40 };

const Camera: React.FC<{ frame: number; total: number; L: Layout; dir: number }> = ({ frame, total, L, dir }) => {
  const camera = useThree(state => state.camera);
  const t = frame / total;
  const z = L.z + (1 - t) * 2.2;
  const angle = Math.sin(t * Math.PI) * 0.28 * dir;
  camera.position.set(Math.sin(angle) * z, L.portrait ? 0.9 : 0.8, Math.cos(angle) * z);
  camera.lookAt(0, L.portrait ? 0.4 : 0.5, 0);
  return null;
};

const Floor: React.FC<{ frame: number; L: Layout }> = ({ frame, L }) => {
  const r = L.portrait ? 4.2 : 7;
  const spots: [number, number, number][] = [[-3.4, 3.6, -3], [3.5, 2.6, -3.5], [-3.8, -0.4, -4], [3.9, -0.8, -3], [0.4, 4.6, -4], [-2.2, 5.6, -5]];
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 8, 6]} intensity={2.4} />
      <pointLight position={[-5, 2, 4]} intensity={50} color="#ff7a45" />
      <pointLight position={[5, 3, -2]} intensity={40} color="#4d7cff" />
      <mesh position={[0, GROUND - 0.1, 0]}>
        <cylinderGeometry args={[r, r + 0.2, 0.2, 64]} />
        <meshStandardMaterial color="#1c2766" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, GROUND + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r - 0.4, r - 0.2, 64]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffb703" emissiveIntensity={0.8} />
      </mesh>
      {spots.map((p, i) => (
        <mesh key={i} position={[p[0] * (L.portrait ? 1 : 1.9), p[1] + Math.sin(frame / 25 + i) * 0.25, p[2]]} rotation={[Math.PI / 2, 0, frame / 20 + i]}>
          <cylinderGeometry args={[0.4, 0.4, 0.08, 32]} />
          <meshStandardMaterial color="#ffd166" metalness={0.9} roughness={0.25} emissive="#ffb703" emissiveIntensity={0.35} />
        </mesh>
      ))}
    </>
  );
};

const Hero: React.FC<{ frame: number; s: SceneData; L: Layout; talking?: boolean }> = ({ frame, s, L, talking = true }) => {
  const dada = s.speaker === 'dada';
  const wave = Math.sin(frame / 6) * 0.25;
  return (
    <Person
      frame={frame}
      elder={dada}
      shirt={dada ? '#8a5a2b' : '#e4572e'}
      pants={dada ? '#efe6d2' : '#2b3a67'}
      hair={dada ? '#e0e0e0' : '#1b1b1b'}
      mood={s.mood || 'happy'}
      talk={talking}
      armR={s.type === 'outro' || s.type === 'talk' ? [0, 2.4 + wave] : [0, 0.2]}
      armL={s.mood === 'shock' ? [0, 1.3] : [0, 0.2]}
      position={[L.px, GROUND, 0]}
      rotationY={0.35}
    />
  );
};

const Props3D: React.FC<{ frame: number; s: SceneData; L: Layout }> = ({ frame, s, L }) => {
  if (s.type === 'coins') {
    const tone = COLORS[s.tone || 'gold'];
    const n = Math.max(1, Math.min(26, s.size || 12)) * ease(frame, 25, 110);
    return <CoinStack x={L.ox} parts={[{ n, color: tone.c, emissive: tone.e }]} />;
  }
  if (s.type === 'compare' && s.a && s.b) {
    const ta = COLORS[s.a.tone];
    const tb = COLORS[s.b.tone];
    return (
      <>
        <CoinStack x={L.ox - 1} r={0.55} parts={[{ n: Math.max(1, Math.min(26, s.a.size)) * ease(frame, 25, 90), color: ta.c, emissive: ta.e }]} />
        <CoinStack x={L.ox + 1} r={0.55} parts={[{ n: Math.max(1, Math.min(26, s.b.size)) * ease(frame, 80, 90), color: tb.c, emissive: tb.e }]} />
      </>
    );
  }
  if (s.type === 'talk' || s.type === 'outro') {
    return (
      <group position={[L.ox, 0.6 + Math.sin(frame / 20) * 0.2, 0]} rotation={[Math.PI / 2.2, frame / 25, 0]} scale={ease(frame, 5, 25) * 1.5}>
        <mesh>
          <cylinderGeometry args={[1.2, 1.2, 0.25, 48]} />
          <meshStandardMaterial color="#ffd166" metalness={0.9} roughness={0.22} emissive="#ffb703" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.85, 0.85, 0.05, 48]} />
          <meshStandardMaterial color="#e2a400" metalness={0.9} roughness={0.3} />
        </mesh>
      </group>
    );
  }
  return null;
};

const Headline: React.FC<{ text: string; L: Layout; frame: number }> = ({ text, L, frame }) => {
  const p = pop(frame);
  return (
    <div style={{ position: 'absolute', top: L.portrait ? 130 : 50, left: L.portrait ? 50 : 120, right: L.portrait ? 50 : 120, textAlign: 'center', fontFamily: FONT, fontWeight: 900, fontSize: (L.portrait ? 78 : 80) * (L.portrait ? 1 : 0.8), lineHeight: 1.2, color: '#fff', transform: `scale(${0.8 + 0.2 * p})`, opacity: p, textShadow: '0 6px 24px rgba(0,0,0,0.65)' }}>
      {text}
    </div>
  );
};

const Subtitle: React.FC<{ s: SceneData; frame: number; L: Layout; frames: number }> = ({ s, frame, L, frames }) => {
  const words = s.narration.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 4) chunks.push(words.slice(i, i + 4).join(' '));
  const idx = Math.min(chunks.length - 1, Math.floor((frame / (frames - GAP * FPS)) * chunks.length));
  return (
    <div style={{ position: 'absolute', bottom: L.portrait ? 200 : 70, left: 60, right: 60, textAlign: 'center', fontFamily: FONT, fontWeight: 800, fontSize: L.portrait ? 62 : 52, lineHeight: 1.3, color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '16px 26px', borderRadius: 26 }}>
      {chunks[Math.max(0, idx)]}
    </div>
  );
};

const Chip: React.FC<{ label: string; tone: Tone; p: number }> = ({ label, tone, p }) => (
  <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: 40, color: '#111', background: COLORS[tone].c, padding: '14px 30px', borderRadius: 50, transform: `scale(${p})`, opacity: p, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>{label}</div>
);

const Overlay: React.FC<{ s: SceneData; frame: number; L: Layout }> = ({ s, frame, L }) => {
  const top = L.portrait ? 380 : 220;
  if (s.type === 'coins' && s.label) {
    return <div style={{ position: 'absolute', top, left: 0, right: 0, display: 'flex', justifyContent: L.portrait ? 'center' : 'flex-end', paddingRight: L.portrait ? 0 : 170 }}><Chip label={s.label} tone={s.tone || 'gold'} p={pop(frame, 40)} /></div>;
  }
  if (s.type === 'compare' && s.a && s.b) {
    return (
      <div style={{ position: 'absolute', top, left: L.portrait ? 40 : 'auto', right: L.portrait ? 40 : 90, width: L.portrait ? 'auto' : 800, display: 'flex', justifyContent: 'space-around', gap: 16 }}>
        <Chip label={s.a.label} tone={s.a.tone} p={pop(frame, 40)} />
        <Chip label={s.b.label} tone={s.b.tone} p={pop(frame, 95)} />
      </div>
    );
  }
  if (s.type === 'list' && s.items) {
    return (
      <div style={{ position: 'absolute', top: L.portrait ? 360 : 190, left: L.portrait ? 60 : 'auto', right: L.portrait ? 60 : 90, width: L.portrait ? 'auto' : 900, fontFamily: FONT }}>
        {s.items.slice(0, 4).map((t, i) => {
          const p = pop(frame, 30 + i * 70);
          return (
            <div key={i} style={{ background: 'rgba(20,20,40,0.85)', border: '3px solid #d4af37', borderRadius: 28, padding: '20px 28px', color: '#fff', fontSize: L.portrait ? 42 : 40, fontWeight: 800, marginBottom: 18, opacity: p, transform: `translateX(${(1 - p) * 120}px)` }}>
              <span style={{ color: '#7df0c3' }}>✔ </span>{t}
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

const SceneView: React.FC<{ s: SceneData; index: number; frames: number; props: StoryProps }> = ({ s, index, frames, props }) => {
  const frame = useCurrentFrame();
  const L = layoutFor(props.orientation);
  const opacity = interpolate(frame, [0, 8, frames - 8, frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity }}>
      {s.audio ? <Audio src={staticFile(s.audio)} /> : null}
      <ThreeCanvas width={L.W} height={L.H} camera={{ position: [0, 1, L.z], fov: L.fov }}>
        <Camera frame={frame} total={frames} L={L} dir={index % 2 === 0 ? 1 : -1} />
        <Floor frame={frame} L={L} />
        <Hero frame={frame} s={s} L={L} />
        <Props3D frame={frame} s={s} L={L} />
      </ThreeCanvas>
      <Headline text={s.headline} L={L} frame={frame} />
      <Overlay s={s} frame={frame} L={L} />
      {s.type === 'outro' && (
        <div style={{ position: 'absolute', top: L.portrait ? 520 : 300, left: L.portrait ? 60 : 'auto', right: L.portrait ? 60 : 120, width: L.portrait ? 'auto' : 800, textAlign: 'center', fontFamily: FONT, fontWeight: 900, fontSize: L.portrait ? 60 : 56, lineHeight: 1.3, color: '#fff', background: 'linear-gradient(90deg,#ff5b5b,#ff9f1c)', padding: '28px', borderRadius: 32, transform: `scale(${0.85 + 0.15 * pop(frame, 20)})`, opacity: pop(frame, 20) }}>
          Follow {props.handle}
        </div>
      )}
      <Subtitle s={s} frame={frame} L={L} frames={frames} />
    </AbsoluteFill>
  );
};

export const Story: React.FC<StoryProps> = props => {
  const L = layoutFor(props.orientation);
  const frame = useCurrentFrame();
  let start = 0;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% ${30 + frame / 120}%, #2b3a8f 0%, #101845 55%, #070a24 100%)` }}>
      {props.scenes.map((s, i) => {
        const frames = Math.round((s.seconds + GAP) * FPS);
        const from = start;
        start += frames;
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <SceneView s={s} index={i} frames={frames} props={props} />
          </Sequence>
        );
      })}
      <div style={{ position: 'absolute', top: L.portrait ? 60 : 20, right: 50, fontFamily: FONT, fontWeight: 800, fontSize: 28, color: '#d4af37' }}>{props.handle}</div>
      <div style={{ position: 'absolute', bottom: L.portrait ? 60 : 18, left: 0, right: 0, textAlign: 'center', fontFamily: 'Arial, sans-serif', fontSize: 22, color: '#8a8fb0' }}>{props.disclaimer}</div>
    </AbsoluteFill>
  );
};

/* ---------- Thumbnail (1280x720) ---------- */

export type ThumbProps = { text: string; sub: string; mood: 'happy' | 'worried' | 'shock' };
export const defaultThumb: ThumbProps = { text: 'डेट ट्रैप', sub: 'SimpledFinance', mood: 'shock' };

export const Thumb: React.FC<ThumbProps> = ({ text, sub, mood }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 70% 40%, #3b4fd0 0%, #151c66 55%, #070a24 100%)' }}>
      <ThreeCanvas width={1280} height={720} camera={{ position: [0, 1.2, 10.5], fov: 40 }}>
        <ambientLight intensity={1} />
        <directionalLight position={[4, 8, 6]} intensity={2.4} />
        <pointLight position={[-5, 2, 4]} intensity={50} color="#ff7a45" />
        <Person frame={frame + 20} mood={mood} talk armL={[0, 1.5]} armR={[0, 1.5]} position={[-3.6, GROUND + 0.2, 0]} rotationY={0.3} scale={1.15} />
        <CoinStack x={4.2} r={0.7} parts={[{ n: 14, color: '#ffc233', emissive: '#ff9f00' }]} />
        <CoinStack x={3.0} r={0.5} parts={[{ n: 7, color: '#ffc233', emissive: '#ff9f00' }]} />
      </ThreeCanvas>
      <div style={{ position: 'absolute', top: 70, left: 430, right: 30, fontFamily: FONT, fontWeight: 900, fontSize: 124, lineHeight: 1.1, color: '#ffe14d', WebkitTextStroke: '6px #000', paintOrder: 'stroke fill' as never, textShadow: '0 10px 30px rgba(0,0,0,0.7)' }}>{text}</div>
      <div style={{ position: 'absolute', bottom: 30, right: 40, fontFamily: FONT, fontWeight: 900, fontSize: 40, color: '#111', background: '#fff', padding: '8px 26px', borderRadius: 40 }}>{sub}</div>
    </AbsoluteFill>
  );
};
