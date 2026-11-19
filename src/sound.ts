// 時間になったことを知らせる音。
// 配布する版は public/sounds/ に置いた音のファイル（効果音工房の素材）を鳴らす。素材は再配布できないので
// git には入れず、ビルドする人が置く（docs/release.md）。ファイルが無い開発中は、その場で作ったチャイムで代える

export type SoundEvent = "workDone" | "breakDone";

/** 選べる音。名前は効果音工房のファイル名のまま（public/sounds/<名前>.mp3）。画面での呼び名は言葉の表の pomo.sound.<名前> */
export const SOUNDS = [
  "se_oshirase06",
  "se_oshirase07",
  "se_oshirase08",
  "se_pikon5",
  "se_teten-1",
  "se_tereterete",
  "se_bell1",
  "se_ka-n01",
  "se_koto01",
  "se_taiko02",
  "se_whistle1",
  "se_bird27",
  "se_dog02",
] as const;

/** 何も選んでいないとき（と、一覧から消した音を選んでいたとき）の音。src-tauri の TimerPrefs の既定と揃える */
const DEFAULT_SOUND: Record<SoundEvent, string> = { workDone: "se_oshirase06", breakDone: "se_pikon5" };

/** 選んでいる音。一覧に無ければ既定の音 */
export function soundOrDefault(name: string, event: SoundEvent): (typeof SOUNDS)[number] {
  const all: readonly string[] = SOUNDS;
  return (all.includes(name) ? name : DEFAULT_SOUND[event]) as (typeof SOUNDS)[number];
}

/** 音のファイルの場所（public/ からの相対） */
export function soundFile(name: string): string {
  return `sounds/${name}.mp3`;
}

/** 配布する版に要る音のファイルの全部。ビルドのときに揃っているか確かめる（vite.config.ts） */
export const SOUND_FILES: string[] = SOUNDS.map(soundFile);

/** 鳴らす 1 音（ファイルが無いときに代わりに作るチャイム） */
export type Note = {
  /** 鳴らし始め（秒、最初の音から） */
  at: number;
  freq: number;
  /** 鳴り終わるまで（秒） */
  dur: number;
  /** 音量 50 のときのいちばん大きいところ */
  peak: number;
};

/** くり返すときの、それぞれの鳴らし始め（秒）。前の音が鳴り終わってから少し空ける。回数は 1〜5 回に収める */
export function repeatStarts(length: number, repeat: number): number[] {
  const times = Math.min(Math.max(Math.round(repeat), 1), 5);
  return Array.from({ length: times }, (_, r) => r * (length + 0.35));
}

/** 代わりのチャイム（3.5.3 までの音）。作業の終わりは下がる音、休憩の終わりは上がる音。音量 0 なら何も鳴らさない */
export function chimeNotes(event: SoundEvent, volume: number, repeat: number): Note[] {
  if (volume <= 0) return [];
  const one = (event === "workDone" ? [880, 660] : [660, 880]).map((f, i) => ({ at: i * 0.28, freq: f, dur: 0.5, peak: 0.25 }));
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
    osc.type = "sine";
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
export async function playSound(name: string, event: SoundEvent, volume: number, repeat: number) {
  if (volume <= 0) return;
  try {
    const ctx = new AudioContext();
    const buffer = await loadBuffer(ctx, soundFile(soundOrDefault(name, event)));
    const end = buffer ? playBuffer(ctx, buffer, volume, repeat) : playNotes(ctx, chimeNotes(event, volume, repeat));
    setTimeout(() => ctx.close().catch(() => {}), (end + 1) * 1000);
  } catch {
    // 音が出せない環境
  }
}
