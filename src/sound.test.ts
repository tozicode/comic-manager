import { describe, expect, it } from "vitest";
import { SOUND_KINDS, soundNotes } from "./sound";

describe("知らせる音", () => {
  it("音量 50・1 回のチャイムは 3.5.3 までと同じ音", () => {
    expect(soundNotes("chime", "workDone", 50, 1).map((n) => [n.at, n.freq, n.peak])).toEqual([
      [0, 880, 0.25],
      [0.28, 660, 0.25],
    ]);
    expect(soundNotes("chime", "breakDone", 50, 1).map((n) => n.freq)).toEqual([660, 880]);
  });

  it("音量は 50 を基準に大きさを変え、0 なら鳴らさない", () => {
    expect(soundNotes("chime", "workDone", 100, 1)[0].peak).toBeCloseTo(0.5);
    expect(soundNotes("chime", "workDone", 25, 1)[0].peak).toBeCloseTo(0.125);
    expect(soundNotes("chime", "workDone", 0, 3)).toEqual([]);
  });

  it("くり返すと、前の音が鳴り終わってから次を鳴らす", () => {
    for (const kind of SOUND_KINDS) {
      const one = soundNotes(kind, "workDone", 50, 1);
      const three = soundNotes(kind, "workDone", 50, 3);
      expect(three).toHaveLength(one.length * 3);
      const end = Math.max(...one.map((n) => n.at + n.dur));
      const second = three[one.length];
      expect(second.at).toBeGreaterThan(end);
    }
  });

  it("くり返しは 1〜5 回に収める", () => {
    const one = soundNotes("marimba", "workDone", 50, 1).length;
    expect(soundNotes("marimba", "workDone", 50, 0)).toHaveLength(one);
    expect(soundNotes("marimba", "workDone", 50, 9)).toHaveLength(one * 5);
  });
});
