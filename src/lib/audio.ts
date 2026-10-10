// Synthesized game audio (no files needed). Call unlock() from a user gesture first.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let crowdGain: GainNode | null = null;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let muted = false;

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.18; musicGain.connect(master);
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0.05; crowdGain.connect(master);
  }
  return ctx;
}

function noiseBuffer(c: AudioContext, secs: number) {
  const b = c.createBuffer(1, c.sampleRate * secs, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export function unlock() {
  const c = ac();
  if (c.state === "suspended") void c.resume();
  startCrowd();
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

function tone(freq: number, dur: number, type: OscillatorType, vol: number, dest?: AudioNode, when = 0, slide?: number) {
  const c = ac(); const t = c.currentTime + when;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest ?? master!); o.start(t); o.stop(t + dur + 0.05);
}

export function sfxKick(power = 1) {
  if (!ctx) return;
  tone(160, 0.18, "sine", 0.7 * power, undefined, 0, 45);
  const c = ctx; const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 0.06);
  const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500;
  const g = c.createGain(); g.gain.value = 0.25 * power;
  s.connect(f).connect(g).connect(master!); s.start();
}

export function sfxBounce(v: number) {
  if (!ctx) return;
  tone(300 + Math.random() * 80, 0.07, "triangle", Math.min(0.25, v * 0.02));
}

export function sfxWhistle() {
  if (!ctx) return;
  const c = ctx; const t = c.currentTime;
  const o = c.createOscillator(); const lfo = c.createOscillator(); const lg = c.createGain(); const g = c.createGain();
  o.type = "sine"; o.frequency.value = 2600; lfo.frequency.value = 28; lg.gain.value = 120;
  lfo.connect(lg).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
  g.gain.setValueAtTime(0.25, t + 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g).connect(master!); o.start(t); lfo.start(t); o.stop(t + 0.65); lfo.stop(t + 0.65);
}

export function sfxGoal() {
  if (!ctx || !crowdGain) return;
  const t = ctx.currentTime;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setTargetAtTime(0.45, t, 0.1);
  crowdGain.gain.setTargetAtTime(0.05, t + 2.2, 0.8);
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, "square", 0.12, undefined, i * 0.1));
  sfxWhistle();
}

export function sfxWin(win: boolean) {
  if (!ctx) return;
  const notes = win ? [523, 659, 784, 1047, 1319] : [392, 349, 311, 262];
  notes.forEach((f, i) => tone(f, 0.4, "square", 0.12, undefined, i * 0.16));
}

let crowdStarted = false;
function startCrowd() {
  if (crowdStarted || !ctx || !crowdGain) return;
  crowdStarted = true;
  const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, 3); s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.6;
  s.connect(f).connect(crowdGain); s.start();
}

// Upbeat stadium chiptune loop.
const BASS = [131, 131, 196, 196, 175, 175, 147, 196];
const MEL = [523, 0, 659, 784, 659, 0, 523, 587, 659, 0, 587, 523, 440, 0, 494, 523,
  587, 0, 698, 880, 784, 0, 659, 587, 523, 0, 587, 659, 523, 0, 0, 0];
export function startMusic() {
  if (!ctx || musicTimer) return;
  let i = 0;
  const beat = 0.16;
  musicTimer = setInterval(() => {
    const m = MEL[i % MEL.length]!;
    if (m) tone(m, beat * 0.9, "square", 0.22, musicGain!);
    if (i % 4 === 0) tone(BASS[Math.floor(i / 4) % BASS.length]!, beat * 3.5, "triangle", 0.5, musicGain!);
    if (i % 2 === 0 && ctx) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, 0.04);
      const g = ctx.createGain(); g.gain.value = i % 8 === 4 ? 0.35 : 0.1;
      s.connect(g).connect(musicGain!); s.start();
    }
    i++;
  }, beat * 1000);
}
export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
}
