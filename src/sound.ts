// 時間になったことを知らせる音。
// 配布する版は public/sounds/ に置いた音のファイル（効果音工房の素材）を鳴らす。素材は再配布できないので
// git には入れず、ビルドする人が置く（docs/release.md）。ファイルが無い開発中は、その場で作った音で代える
import type { SoundKind } from "./api.ts";

export type SoundEvent = "workDone" | "breakDone";
const SOUND_EVENTS: SoundEvent[] = ["workDone", "breakDone"];

/** 鳴らす 1 音 */
export type Note = {
  /** 鳴らし始め（秒、最初の音から） */
  at: number;
  freq: number;
  /** 鳴り終わるまで（秒） */
  dur: number;
  wave: OscillatorType;
  /** 音量 50 のときのいちばん大きいところ */
  peak: number;
};

export const SOUND_KINDS: SoundKind[] = ["chime", "bell", "marimba", "alarm"];

/** 音のファイルの場所（public/ からの相対）。種類ごとに、作業の終わりと休憩の終わりの 2 つ */
export function soundFile(kind: SoundKind, event: SoundEvent): string {
  return `sounds/${kind}-${event}.mp3`;
}

/** 配布する版に要る音のファイルの全部。ビルドのときに揃っているか確かめる（vite.config.ts） */
export const SOUND_FILES: string[] = SOUND_KINDS.flatMap((k) => SOUND_EVENTS.map((e) => soundFile(k, e)));

/** くり返すときの、それぞれの鳴らし始め（秒）。前の音が鳴り終わってから少し空ける。回数は 1〜5 回に収める */
export function repeatStarts(length: number, repeat: number): number[] {
  const times = Math.min(Math.max(Math.round(repeat), 1), 5);
  return Array.from({ length: times }, (_, r) => r * (length + 0.35));
}

/** 1 回分の音の並び。作業の終わりは下がる音、休憩の終わりは上がる音にして聞き分けられるようにする */
function pattern(kind: SoundKind, event: SoundEvent): Note[] {
  const down = event === "workDone";
  const order = <T>(xs: T[]) => (down ? xs : [...xs].reverse());
  switch (kind) {
    case "bell":
      // 余韻の長い鐘。倍音を重ねる
      return order([988, 784]).flatMap((f, i) =>
        [1, 2, 3].map((h) => ({ at: i * 0.6, freq: f * h, dur: 1.6 / h, wave: "sine" as const, peak: 0.22 / h })),
      );
    case "marimba":
      // 木琴風の 3 音
      return order([1047, 784, 523]).map((f, i) => ({ at: i * 0.16, freq: f, dur: 0.35, wave: "triangle" as const, peak: 0.3 }));
    case "alarm":
      // 目覚まし風の短い 4 連打。矩形波は大きく聞こえるので控えめにする
      return [0, 1, 2, 3].map((i) => ({ at: i * 0.18, freq: down ? 1046 : 1318, dur: 0.1, wave: "square" as const, peak: 0.08 }));
    default:
      // 3.5.3 までのチャイム
      return (down ? [880, 660] : [660, 880]).map((f, i) => ({ at: i * 0.28, freq: f, dur: 0.5, wave: "sine" as const, peak: 0.25 }));
  }
}

/** くり返しも含めた、鳴らす音の全部。音量 0 なら何も鳴らさない */
export function soundNotes(kind: SoundKind, event: SoundEvent, volume: number, repeat: number): Note[] {
  if (volume <= 0) return [];
  const one = pattern(kind, event);
  const length = Math.max(...one.map((n) => n.at + n.dur));
  const scale = Math.min(volume, 100) / 50;
  return repeatStarts(length, repeat).flatMap((start) => one.map((n) => ({ ...n, at: n.at + start, peak: n.peak * scale })));
}

/** 読み込んだ音のファイル。読めなかったら null（開発中でファイルが無いときなど） */
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function loadBuffer(ctx: AudioContext, path: string): Promise<AudioBuffer | null> {
  let p = buffers.get(path);
  if (!p) {
    p = fetch(`/${path}`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    buffers.set(path, p);
  }
  return p;
}

/** 音のファイルを鳴らし、鳴り終わる時刻（秒）を返す。音量 100 でファイルそのままの大きさ */
function playBuffer(ctx: AudioContext, buffer: AudioBuffer, volume: number, repeat: number): number {
  const start = ctx.currentTime + 0.02;
  const gain = ctx.createGain();
  gain.gain.value = Math.min(volume, 100) / 100;
  gain.connect(ctx.destination);
  const starts = repeatStarts(buffer.duration, repeat);
  for (const at of starts) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    src.start(start + at);
  }
  return starts[starts.length - 1] + buffer.duration;
}

/** その場で作った音を鳴らし、鳴り終わる時刻（秒）を返す */
function playNotes(ctx: AudioContext, notes: Note[]): number {
  const start = ctx.currentTime + 0.02;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = start + n.at;
    osc.type = n.wave;
    osc.frequency.value = n.freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(n.peak, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + n.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + n.dur + 0.05);
  }
  return Math.max(...notes.map((n) => n.at + n.dur));
}

/** 音を鳴らす。鳴らせなくても通知と画面の表示で分かるので、失敗は黙って見送る */
export async function playSound(kind: SoundKind, event: SoundEvent, volume: number, repeat: number) {
  if (volume <= 0) return;
  try {
    const ctx = new AudioContext();
    const buffer = await loadBuffer(ctx, soundFile(kind, event));
    const end = buffer ? playBuffer(ctx, buffer, volume, repeat) : playNotes(ctx, soundNotes(kind, event, volume, repeat));
    setTimeout(() => ctx.close().catch(() => {}), (end + 1) * 1000);
  } catch {
    // 音が出せない環境
  }
}
