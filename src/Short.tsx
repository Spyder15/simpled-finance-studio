import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';

const FPS = 30;
// Scene lengths follow the narration clips (s1..s5.mp3) plus a short pause
const SCENES = [
  { audio: 's1.mp3', seconds: 9.9 },
  { audio: 's2.mp3', seconds: 15.0 },
  { audio: 's3.mp3', seconds: 11.6 },
  { audio: 's4.mp3', seconds: 12.4 },
  { audio: 's5.mp3', seconds: 14.4 }
].map(scene => ({ ...scene, frames: Math.round(scene.seconds * FPS) }));

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.frames, 0);

const FONT = '"Kohinoor Devanagari", "Devanagari Sangam MN", "Helvetica Neue", Arial, sans-serif';
const rupee = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (frame: number, start: number, dur: number) => {
  const t = clamp01((frame - start) / dur);
  return 1 - Math.pow(1 - t, 3);
};

export const GROUND = -2;

/* ---------- Camera + lights + floor ---------- */

const CameraRig: React.FC<{ frame: number; z0: number; z1: number; swing?: number; y?: number; total: number }> = ({ frame, z0, z1, swing = 0.25, y = 0.6, total }) => {
  const camera = useThree(state => state.camera);
  const t = frame / total;
  const z = z0 + (z1 - z0) * t;
  const angle = Math.sin(t * Math.PI) * swing;
  camera.position.set(Math.sin(angle) * z, y, Math.cos(angle) * z);
  camera.lookAt(0, 0.2, 0);
  return null;
};

const World: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    <ambientLight intensity={0.9} />
    <directionalLight position={[4, 8, 6]} intensity={2.4} />
    <pointLight position={[-5, 2, 4]} intensity={50} color="#ff7a45" />
    <pointLight position={[5, 3, -2]} intensity={40} color="#4d7cff" />
    <mesh position={[0, GROUND - 0.1, 0]}>
      <cylinderGeometry args={[4.2, 4.4, 0.2, 64]} />
      <meshStandardMaterial color="#1c2766" metalness={0.6} roughness={0.35} />
    </mesh>
    <mesh position={[0, GROUND + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[3.8, 4.0, 64]} />
      <meshStandardMaterial color="#ffd166" emissive="#ffb703" emissiveIntensity={0.8} />
    </mesh>
    <FloatingCoins frame={frame} />
  </>
);

const FloatingCoins: React.FC<{ frame: number }> = ({ frame }) => {
  const spots: [number, number, number][] = [[-3.4, 3.6, -3], [3.5, 2.6, -3.5], [-3.8, -0.4, -4], [3.9, -0.8, -3], [0.4, 4.6, -4], [-2.2, 5.6, -5]];
  return (
    <>
      {spots.map((p, i) => (
        <mesh key={i} position={[p[0], p[1] + Math.sin(frame / 25 + i) * 0.25, p[2]]} rotation={[Math.PI / 2, 0, frame / 20 + i]}>
          <cylinderGeometry args={[0.4, 0.4, 0.08, 32]} />
          <meshStandardMaterial color="#ffd166" metalness={0.9} roughness={0.25} emissive="#ffb703" emissiveIntensity={0.35} />
        </mesh>
      ))}
    </>
  );
};

/* ---------- Rahul (3D character built from primitives) ---------- */

type Mood = 'happy' | 'worried' | 'shock';
type PersonProps = {
  frame: number;
  shirt?: string;
  pants?: string;
  hair?: string;
  elder?: boolean;
  mood?: Mood;
  talk?: boolean;
  walk?: boolean;
  armL?: [number, number];
  armR?: [number, number];
  bags?: boolean;
  position?: [number, number, number];
  rotationY?: number;
  scale?: number;
};

const SKIN = '#f1b98a';

const Arm: React.FC<{ side: 1 | -1; rot: [number, number]; bag?: boolean; color: string }> = ({ side, rot, bag, color }) => (
  <group position={[0.58 * side, 2.1, 0]} rotation={[rot[0], 0, rot[1] * side]}>
    <mesh position={[0, -0.4, 0]}>
      <capsuleGeometry args={[0.13, 0.55, 8, 16]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
    <mesh position={[0, -0.88, 0]}>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshStandardMaterial color={SKIN} roughness={0.7} />
    </mesh>
    {bag && (
      <group position={[0, -1.15, 0.05]}>
        <mesh>
          <boxGeometry args={[0.55, 0.65, 0.3]} />
          <meshStandardMaterial color="#ffd166" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.38, 0]}>
          <torusGeometry args={[0.16, 0.025, 8, 24, Math.PI]} />
          <meshStandardMaterial color="#8d5524" />
        </mesh>
      </group>
    )}
  </group>
);

export const Person: React.FC<PersonProps> = ({ frame, shirt = '#e4572e', pants = '#2b3a67', hair = '#1b1b1b', elder = false, mood = 'happy', talk = false, walk = false, armL = [0, 0.15], armR = [0, 0.15], bags = false, position = [0, GROUND, 0], rotationY = 0, scale = 1 }) => {
  const bob = Math.abs(Math.sin(frame / (walk ? 4 : 10))) * (walk ? 0.08 : 0.03);
  const swing = walk ? Math.sin(frame / 4) * 0.5 : 0;
  const mouthOpen = talk ? 0.15 + Math.abs(Math.sin(frame / 2.2)) * 0.55 : mood === 'shock' ? 0.9 : 0.2;
  const browTilt = mood === 'worried' ? 0.35 : mood === 'shock' ? -0.05 : -0.1;
  const browLift = mood === 'shock' ? 0.06 : 0;
  const blink = frame % 90 < 4 ? 0.1 : 1;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <group position={[0, bob, 0]}>
        {/* legs */}
        {[-1, 1].map(s => (
          <group key={s} position={[0.22 * s, 1.15, 0]} rotation={[swing * s, 0, 0]}>
            <mesh position={[0, -0.5, 0]}>
              <capsuleGeometry args={[0.17, 0.7, 8, 16]} />
              <meshStandardMaterial color={pants} roughness={0.7} />
            </mesh>
            <mesh position={[0, -1.1, 0.1]}>
              <boxGeometry args={[0.32, 0.18, 0.5]} />
              <meshStandardMaterial color="#f5f5f5" roughness={0.5} />
            </mesh>
          </group>
        ))}
        {/* torso */}
        <mesh position={[0, 1.7, 0]}>
          <capsuleGeometry args={[0.45, 0.6, 8, 24]} />
          <meshStandardMaterial color={shirt} roughness={0.6} />
        </mesh>
        <Arm side={-1} rot={[armL[0] + swing, armL[1]]} bag={bags} color={shirt} />
        <Arm side={1} rot={[armR[0] - swing, armR[1]]} bag={bags} color={shirt} />
        {/* head */}
        <group position={[0, 2.85, 0]} rotation={[0, Math.sin(frame / 35) * 0.15, mood === 'worried' ? 0.08 : 0]}>
          <mesh>
            <sphereGeometry args={[0.52, 32, 32]} />
            <meshStandardMaterial color={SKIN} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.06, -0.04]} rotation={[-0.25, 0, 0]}>
            <sphereGeometry args={[0.56, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color={hair} roughness={0.9} />
          </mesh>
          {elder && (
            <>
              <mesh position={[0, -0.12, 0.5]} scale={[1.6, 0.35, 0.6]}>
                <sphereGeometry args={[0.15, 16, 16]} />
                <meshStandardMaterial color="#e8e8e8" roughness={0.9} />
              </mesh>
              {[-1, 1].map(s => (
                <mesh key={s} position={[0.5 * s, -0.05, 0]}>
                  <sphereGeometry args={[0.15, 16, 16]} />
                  <meshStandardMaterial color="#e8e8e8" roughness={0.9} />
                </mesh>
              ))}
            </>
          )}
          {[-1, 1].map(s => (
            <group key={s} position={[0.2 * s, 0.08, 0.44]}>
              <mesh scale={[1, blink, 1]}>
                <sphereGeometry args={[0.12, 16, 16]} />
                <meshStandardMaterial color="#ffffff" />
              </mesh>
              <mesh position={[0, 0, 0.09]} scale={[1, blink, 1]}>
                <sphereGeometry args={[0.065, 16, 16]} />
                <meshStandardMaterial color="#111111" />
              </mesh>
              <mesh position={[0, 0.2 + browLift, 0.02]} rotation={[0, 0, browTilt * s * -1]}>
                <boxGeometry args={[0.24, 0.045, 0.05]} />
                <meshStandardMaterial color="#1b1b1b" />
              </mesh>
            </group>
          ))}
          <mesh position={[0, elder ? -0.3 : -0.22, 0.46]} scale={[1, mouthOpen, 0.5]}>
            <sphereGeometry args={[0.13, 16, 16]} />
            <meshStandardMaterial color="#5a1a1a" />
          </mesh>
          {mood === 'worried' && (
            <mesh position={[0.42, 0.25 + ((frame / 2) % 12) * -0.03, 0.3]}>
              <sphereGeometry args={[0.06, 12, 12]} />
              <meshStandardMaterial color="#7fd6ff" emissive="#4cc3ff" emissiveIntensity={0.5} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
};

/* ---------- Props: credit card, coin stacks ---------- */

const CreditCard: React.FC<{ frame: number; position: [number, number, number]; scale?: number }> = ({ frame, position, scale = 1 }) => (
  <group scale={scale} position={[position[0], position[1] + Math.sin(frame / 22) * 0.15, position[2]]} rotation={[0.2, Math.sin(frame / 30) * 0.7 + frame / 90, 0.08]}>
    <mesh>
      <boxGeometry args={[3.4, 2.15, 0.12]} />
      <meshStandardMaterial color="#1b2a6b" metalness={0.7} roughness={0.25} />
    </mesh>
    <mesh position={[-1.0, 0.35, 0.07]}>
      <boxGeometry args={[0.6, 0.45, 0.03]} />
      <meshStandardMaterial color="#f2c14e" metalness={0.9} roughness={0.2} />
    </mesh>
    <mesh position={[0, 0.9, 0.07]}>
      <boxGeometry args={[3.4, 0.35, 0.03]} />
      <meshStandardMaterial color="#0b1030" />
    </mesh>
    <mesh position={[0.9, -0.7, 0.07]}>
      <torusGeometry args={[0.25, 0.07, 16, 40]} />
      <meshStandardMaterial color="#ff4d4d" emissive="#ff2a2a" emissiveIntensity={0.4} />
    </mesh>
    <mesh position={[1.17, -0.7, 0.07]}>
      <torusGeometry args={[0.25, 0.07, 16, 40]} />
      <meshStandardMaterial color="#ffb703" emissive="#ff9f00" emissiveIntensity={0.4} />
    </mesh>
    <mesh position={[-0.6, -0.7, 0.07]}>
      <boxGeometry args={[1.8, 0.12, 0.03]} />
      <meshStandardMaterial color="#c9d1ff" />
    </mesh>
  </group>
);

type Part = { n: number; color: string; emissive?: string };

export const CoinStack: React.FC<{ x: number; z?: number; parts: Part[]; r?: number; h?: number }> = ({ x, z = 0, parts, r = 0.7, h = 0.12 }) => {
  const coins: React.ReactNode[] = [];
  let idx = 0;
  parts.forEach((part, pi) => {
    const whole = Math.floor(part.n);
    const frac = part.n - whole;
    const total = whole + (frac > 0.01 ? 1 : 0);
    for (let k = 0; k < total; k++) {
      const sy = k < whole ? 1 : frac;
      coins.push(
        <mesh key={`${pi}-${k}`} position={[x, GROUND + h * idx + (h * sy) / 2, z]} scale={[1, sy, 1]}>
          <cylinderGeometry args={[r, r, h * 0.92, 32]} />
          <meshStandardMaterial color={part.color} emissive={part.emissive || '#000000'} emissiveIntensity={part.emissive ? 0.45 : 0} metalness={0.8} roughness={0.28} />
        </mesh>
      );
      idx += sy;
    }
  });
  return <>{coins}</>;
};

/* ---------- 2D overlay helpers ---------- */

const Stage: React.FC<{ children: React.ReactNode; frames: number; audio: string }> = ({ children, frames, audio }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, frames - 8, frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity }}>
      <Audio src={staticFile(audio)} />
      {children}
    </AbsoluteFill>
  );
};

const Title: React.FC<{ top?: number; children: React.ReactNode; size?: number }> = ({ top = 150, children, size = 88 }) => {
  const frame = useCurrentFrame();
  const pop = spring({ frame, fps: FPS, config: { damping: 14 } });
  return (
    <div style={{ position: 'absolute', top, left: 60, right: 60, textAlign: 'center', fontFamily: FONT, fontWeight: 900, fontSize: size, lineHeight: 1.15, color: '#fff', transform: `scale(${0.8 + 0.2 * pop})`, opacity: pop, textShadow: '0 6px 24px rgba(0,0,0,0.6)' }}>
      {children}
    </div>
  );
};

const Caption: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'absolute', bottom: 190, left: 70, right: 70, textAlign: 'center', fontFamily: FONT, fontWeight: 700, fontSize: 52, lineHeight: 1.35, color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '22px 28px', borderRadius: 28 }}>
    {children}
  </div>
);

const Scene3D: React.FC<{ frame: number; total: number; z0: number; z1: number; swing?: number; children: React.ReactNode }> = ({ frame, total, z0, z1, swing, children }) => (
  <ThreeCanvas width={1080} height={1920} camera={{ position: [0, 0.6, z0], fov: 42 }}>
    <CameraRig frame={frame} total={total} z0={z0} z1={z1} swing={swing} />
    <World frame={frame} />
    {children}
  </ThreeCanvas>
);

const Background = () => {
  const frame = useCurrentFrame();
  const shift = interpolate(frame, [0, TOTAL_FRAMES], [0, 40]);
  return <AbsoluteFill style={{ background: `radial-gradient(circle at 50% ${30 + shift / 4}%, #2b3a8f 0%, #101845 55%, #070a24 100%)` }} />;
};

/* ---------- Scenes ---------- */

const Scene1 = () => {
  const frame = useCurrentFrame();
  const total = SCENES[0].frames;
  const enter = ease(frame, 0, 25);
  return (
    <>
      <Scene3D frame={frame} total={total} z0={17} z1={13.5} swing={0.3}>
        <Person frame={frame} mood="happy" talk armR={[0, 2.5 + Math.sin(frame / 5) * 0.3]} position={[-1.5, GROUND - (1 - enter) * 4, 0]} rotationY={0.35} />
        <CreditCard frame={frame} position={[1.4, 0.9 + (1 - enter) * 4, 0]} scale={0.68} />
      </Scene3D>
      <Title>क्रेडिट कार्ड का <span style={{ color: '#ff5b5b' }}>जाल</span></Title>
      <Caption>बैंक कहता है: बस थोड़ा सा भर दो…</Caption>
    </>
  );
};

const Scene2 = () => {
  const frame = useCurrentFrame();
  const total = SCENES[1].frames;
  const bill = ease(frame, 40, 140);
  const minimum = ease(frame, 250, 30);
  return (
    <>
      <Scene3D frame={frame} total={total} z0={15} z1={13} swing={-0.3}>
        <Person frame={frame} mood="worried" talk={frame < 300} armL={[0, 0.3]} armR={[0, 0.3]} position={[-1.9, GROUND, 0]} rotationY={0.4} />
        <CoinStack x={0.9} parts={[{ n: 20 * bill, color: '#ffc233', emissive: '#ff9f00' }]} />
        <CoinStack x={2.3} r={0.42} parts={[{ n: 1 * minimum, color: '#38d39f', emissive: '#10b981' }]} />
      </Scene3D>
      <Title top={130} size={80}>राहुल का <span style={{ color: '#ffd166' }}>{rupee(50000 * bill)}</span> खर्च</Title>
      <Caption>मिनिमम ड्यू सिर्फ़ {rupee(2500)} था</Caption>
    </>
  );
};

const Scene3 = () => {
  const frame = useCurrentFrame();
  const total = SCENES[2].frames;
  const interest = ease(frame, 120, 180);
  return (
    <>
      <Scene3D frame={frame} total={total} z0={13} z1={15} swing={0.35}>
        <Person frame={frame} mood="shock" armL={[0, 1.4]} armR={[0, 1.4]} position={[-1.9, GROUND, 0]} rotationY={0.4} />
        <CoinStack x={1.2} parts={[{ n: 19, color: '#ff4040', emissive: '#d90429' }, { n: 6 * interest, color: '#ffc233', emissive: '#ff9f00' }]} />
        <group position={[1.2, GROUND + 0.12 * (19 + 6 * interest) + 0.3, 0]} rotation={[Math.PI / 2.4, frame / 18, 0]} scale={0.9 * ease(frame, 90, 25)}>
          <mesh>
            <torusGeometry args={[1.1, 0.1, 24, 80]} />
            <meshStandardMaterial color="#ffd166" emissive="#ffb703" emissiveIntensity={0.7} metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      </Scene3D>
      <Title top={130} size={72}>बिल खत्म नहीं हुआ!</Title>
      <div style={{ position: 'absolute', top: 1240, left: 0, right: 0, textAlign: 'center', fontFamily: FONT, fontWeight: 900, fontSize: 56, color: '#ff9a9a', textShadow: '0 4px 16px rgba(0,0,0,0.7)', opacity: interest }}>बाकी {rupee(47500)} पर ब्याज</div>
      <Caption>इंटरेस्ट-फ़्री पीरियड भी असर में आ सकता है</Caption>
    </>
  );
};

const Scene4 = () => {
  const frame = useCurrentFrame();
  const total = SCENES[3].frames;
  const targets = [9, 14, 19, 26];
  const labels = ['महीना 1', 'महीना 2', 'महीना 3', 'महीना 4'];
  const xs = [-0.9, 0.05, 1.0, 1.95];
  return (
    <>
      <Scene3D frame={frame} total={total} z0={14} z1={14} swing={0}>
        <Person frame={frame} mood="happy" walk={frame < 150} bags armL={[0, 0.2]} armR={[0, 0.2]} position={[-2.35, GROUND, 0.3]} rotationY={0.5} scale={0.72} />
        {targets.map((n, i) => (
          <CoinStack key={i} x={xs[i]} r={0.36} h={0.1} parts={[{ n: n * ease(frame, 30 + i * 70, 60), color: i === 3 ? '#ff3b3b' : '#ff8a3d', emissive: i === 3 ? '#d90429' : '#ff5a00' }]} />
        ))}
      </Scene3D>
      <Title top={130} size={72}>छोटा बिल → <span style={{ color: '#ff5b5b' }}>डेट ट्रैप</span></Title>
      <div style={{ position: 'absolute', top: 1345, left: 0, right: 0 }}>
        {labels.map((label, i) => (
          <span key={label} style={{ position: 'absolute', left: 540 + xs[i] * 178 - 70, width: 140, textAlign: 'center', fontFamily: FONT, fontWeight: 800, fontSize: 30, color: '#ffd9c2' }}>{label}</span>
        ))}
      </div>
      <Caption>पुराना बैलेंस + नई शॉपिंग = और बड़ा बिल</Caption>
    </>
  );
};

const Scene5 = () => {
  const frame = useCurrentFrame();
  const total = SCENES[4].frames;
  const cta = spring({ frame: frame - 230, fps: FPS, config: { damping: 14 } });
  return (
    <>
      <Scene3D frame={frame} total={total} z0={15} z1={12.5} swing={-0.3}>
        <Person frame={frame} mood="happy" talk armR={[0, 2.6 + Math.sin(frame / 6) * 0.25]} armL={[0, 0.2]} position={[-1.5, GROUND, 0]} rotationY={0.35} />
        <CreditCard frame={frame} position={[1.5, 0.6, 0]} scale={0.65} />
      </Scene3D>
      <Title top={120} size={66}>मिनिमम ड्यू = <span style={{ color: '#7df0c3' }}>लेट फ़ीस से बचाव</span>, कर्ज़ से नहीं</Title>
      <div style={{ position: 'absolute', bottom: 190, left: 60, right: 60, textAlign: 'center', fontFamily: FONT, fontWeight: 900, fontSize: 58, lineHeight: 1.3, color: '#fff', background: 'linear-gradient(90deg,#ff5b5b,#ff9f1c)', padding: '30px', borderRadius: 32, opacity: cta, transform: `scale(${0.85 + 0.15 * cta})` }}>
        फ़ुल बिल या सिर्फ़ मिनिमम?<br />कमेंट में बताओ<br /><span style={{ fontSize: 46 }}>Follow @SimpledFinance</span>
      </div>
    </>
  );
};

export const Short: React.FC = () => {
  const scenes = [Scene1, Scene2, Scene3, Scene4, Scene5];
  let start = 0;
  return (
    <AbsoluteFill>
      <Background />
      {SCENES.map((scene, index) => {
        const from = start;
        start += scene.frames;
        const SceneComponent = scenes[index];
        return (
          <Sequence key={index} from={from} durationInFrames={scene.frames}>
            <Stage frames={scene.frames} audio={scene.audio}>
              <SceneComponent />
            </Stage>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
