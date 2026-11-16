/** 纯 WebAudio 合成的提示音与白噪音，不依赖任何音频文件 */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

type Note = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number };

function playNotes(notes: Note[], volume = 0.7): void {
  const context = audioCtx();
  if (!context) return;
  const master = context.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.5;
  master.connect(context.destination);

  const now = context.currentTime;
  for (const note of notes) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = note.type ?? 'sine';
    osc.frequency.value = note.freq;

    const start = now + note.at;
    const peak = note.gain ?? 0.35;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + note.dur + 0.05);
  }

  window.setTimeout(() => master.disconnect(), 6000);
}

const NOTE = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.5,
};

/** 提醒铃声预设（每个都是短促的一段旋律） */
const RECIPES: Record<string, () => Note[]> = {
  chimes: () => [
    { freq: NOTE.C5, at: 0, dur: 0.7 },
    { freq: NOTE.E5, at: 0.14, dur: 0.7 },
    { freq: NOTE.G5, at: 0.28, dur: 0.9 },
  ],
  crystal: () => [
    { freq: NOTE.C6, at: 0, dur: 0.5, type: 'triangle' },
    { freq: NOTE.E6, at: 0.1, dur: 0.5, type: 'triangle' },
    { freq: NOTE.C6, at: 0.22, dur: 0.7, type: 'triangle' },
  ],
  beep: () => [
    { freq: NOTE.A5, at: 0, dur: 0.16, type: 'square', gain: 0.2 },
    { freq: NOTE.A5, at: 0.24, dur: 0.16, type: 'square', gain: 0.2 },
  ],
  pulse: () => [
    { freq: NOTE.G4, at: 0, dur: 0.24, gain: 0.3 },
    { freq: NOTE.G4, at: 0.3, dur: 0.24, gain: 0.3 },
    { freq: NOTE.C5, at: 0.6, dur: 0.4, gain: 0.3 },
  ],
  leap: () => [
    { freq: NOTE.C5, at: 0, dur: 0.2, type: 'triangle' },
    { freq: NOTE.G5, at: 0.12, dur: 0.3, type: 'triangle' },
    { freq: NOTE.C6, at: 0.26, dur: 0.5, type: 'triangle' },
  ],
  music_box: () => [
    { freq: NOTE.E5, at: 0, dur: 0.45 },
    { freq: NOTE.G5, at: 0.16, dur: 0.45 },
    { freq: NOTE.C6, at: 0.32, dur: 0.6 },
  ],
  blocks: () => [
    { freq: NOTE.D4, at: 0, dur: 0.12, type: 'square', gain: 0.18 },
    { freq: NOTE.D4, at: 0.16, dur: 0.12, type: 'square', gain: 0.18 },
    { freq: NOTE.G4, at: 0.32, dur: 0.2, type: 'square', gain: 0.18 },
  ],
  matrix: () => [
    { freq: NOTE.C5, at: 0, dur: 0.3, type: 'sawtooth', gain: 0.14 },
    { freq: NOTE.A4, at: 0.18, dur: 0.3, type: 'sawtooth', gain: 0.14 },
    { freq: NOTE.C5, at: 0.36, dur: 0.5, type: 'sawtooth', gain: 0.14 },
  ],
  harp: () => [
    { freq: NOTE.G4, at: 0, dur: 0.5, type: 'triangle' },
    { freq: NOTE.A4, at: 0.09, dur: 0.5, type: 'triangle' },
    { freq: NOTE.C5, at: 0.18, dur: 0.5, type: 'triangle' },
    { freq: NOTE.E5, at: 0.27, dur: 0.9, type: 'triangle' },
  ],
  ladder: () => [
    { freq: NOTE.C5, at: 0, dur: 0.22 },
    { freq: NOTE.D5, at: 0.12, dur: 0.22 },
    { freq: NOTE.E5, at: 0.24, dur: 0.22 },
    { freq: NOTE.G5, at: 0.36, dur: 0.5 },
  ],
  lattice: () => [
    { freq: NOTE.D5, at: 0, dur: 0.4, type: 'sine' },
    { freq: NOTE.A5, at: 0.15, dur: 0.6, type: 'sine' },
  ],
  africa: () => [
    { freq: NOTE.C4, at: 0, dur: 0.18, type: 'square', gain: 0.16 },
    { freq: NOTE.G4, at: 0.12, dur: 0.18, type: 'square', gain: 0.16 },
    { freq: NOTE.C5, at: 0.24, dur: 0.4, type: 'square', gain: 0.16 },
  ],
  spiral: () => [
    { freq: NOTE.E5, at: 0, dur: 0.5 },
    { freq: NOTE.C6, at: 0.2, dur: 0.7 },
  ],
  knock: () => [
    { freq: 180, at: 0, dur: 0.1, type: 'square', gain: 0.25 },
    { freq: 180, at: 0.16, dur: 0.1, type: 'square', gain: 0.25 },
  ],
  drip: () => [
    { freq: NOTE.A5, at: 0, dur: 0.25, type: 'sine' },
    { freq: NOTE.E5, at: 0.08, dur: 0.35, type: 'sine' },
  ],
  jingle: () => [
    { freq: NOTE.G5, at: 0, dur: 0.3 },
    { freq: NOTE.E5, at: 0.1, dur: 0.3 },
    { freq: NOTE.C6, at: 0.2, dur: 0.5 },
  ],
  pop: () => [{ freq: 900, at: 0, dur: 0.09, type: 'sine', gain: 0.3 }],
};

export const REMIND_SOUNDS = [
  { id: 'chimes', label: '风铃' },
  { id: 'crystal', label: '水晶' },
  { id: 'beep', label: '滴滴' },
  { id: 'pulse', label: '脉冲' },
  { id: 'leap', label: '跃动' },
  { id: 'music_box', label: '八音盒' },
  { id: 'blocks', label: '积木' },
  { id: 'matrix', label: '矩阵' },
  { id: 'harp', label: '竖琴' },
  { id: 'ladder', label: '阶梯' },
  { id: 'lattice', label: '网格' },
  { id: 'africa', label: '非洲鼓' },
  { id: 'spiral', label: '螺旋' },
  { id: 'knock', label: '敲门' },
] as const;

export const COMPLETION_SOUNDS = [
  { id: 'drip', label: '水滴' },
  { id: 'jingle', label: '清脆' },
  { id: 'knock', label: '木质' },
  { id: 'pop', label: '轻响' },
  { id: 'none', label: '静音' },
] as const;

export function playRemindSound(id: string, volume = 70): void {
  const recipe = RECIPES[id] ?? RECIPES.chimes!;
  playNotes(recipe(), volume);
}

export function playCompletionSound(id: string, volume = 70): void {
  if (id === 'none') return;
  const recipe = RECIPES[id] ?? RECIPES.pop!;
  playNotes(recipe(), Math.min(volume, 60));
}

/* --------------------------- 白噪音 --------------------------- */

export type NoiseKind = 'none' | 'white' | 'brown' | 'rain' | 'waves';

let noiseSource: AudioBufferSourceNode | null = null;
let noiseGain: GainNode | null = null;

export const NOISE_KINDS: { id: NoiseKind; label: string }[] = [
  { id: 'none', label: '关闭' },
  { id: 'white', label: '白噪音' },
  { id: 'brown', label: '棕色噪音' },
  { id: 'rain', label: '雨声' },
  { id: 'waves', label: '海浪' },
];

export function stopNoise(): void {
  try {
    noiseSource?.stop();
  } catch {
    // 已经停止
  }
  noiseSource?.disconnect();
  noiseGain?.disconnect();
  noiseSource = null;
  noiseGain = null;
}

export function startNoise(kind: NoiseKind, volume = 40): void {
  stopNoise();
  if (kind === 'none') return;

  const context = audioCtx();
  if (!context) return;

  const seconds = 4;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);

  let last = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') {
      data[index] = white * 0.4;
    } else if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[index] = last * 3.2;
    } else if (kind === 'rain') {
      // 雨声：高频增强的噪声 + 随机强弱
      last = last * 0.6 + white * 0.4;
      data[index] = (white * 0.35 + last * 0.25) * (0.75 + Math.random() * 0.25);
    } else {
      // 海浪：极低频包络 + 低通噪声
      last = last * 0.985 + white * 0.015;
      const swell = 0.5 + 0.5 * Math.sin((index / data.length) * Math.PI * 4);
      data[index] = last * 6 * swell;
    }
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = kind === 'rain' ? 'highpass' : 'lowpass';
  filter.frequency.value = kind === 'rain' ? 1200 : kind === 'brown' ? 700 : 2400;

  const gain = context.createGain();
  gain.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.35;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start();

  noiseSource = source;
  noiseGain = gain;
}

/** 让浏览器允许播放音频（首次用户交互时调用） */
export function unlockAudio(): void {
  audioCtx();
}
