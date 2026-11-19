import { describe, expect, it } from "vitest";
import { chimeNotes, repeatStarts, SOUND_FILES, SOUNDS, soundOrDefault } from "./sound";
import { t } from "./i18n/settings";

describe("知らせる音", () => {
  it("ファイルが無いときのチャイムは 3.5.3 までと同じ音", () => {
    expect(chimeNotes("workDone", 50, 1).map((n) => [n.at, n.freq, n.peak])).toEqual([
      [0, 880, 0.25],
      [0.28, 660, 0.25],
    ]);
    expect(chimeNotes("breakDone", 50, 1).map((n) => n.freq)).toEqual([660, 880]);
  });

  it("音量は 50 を基準に大きさを変え、0 なら鳴らさない", () => {
    expect(chimeNotes("workDone", 100, 1)[0].peak).toBeCloseTo(0.5);
    expect(chimeNotes("workDone", 25, 1)[0].peak).toBeCloseTo(0.125);
    expect(chimeNotes("workDone", 0, 3)).toEqual([]);
  });

  it("くり返すと、前の音が鳴り終わってから次を鳴らす", () => {
    const starts = repeatStarts(1.5, 3);
    expect(starts).toHaveLength(3);
    [0, 1.85, 3.7].forEach((s, i) => expect(starts[i]).toBeCloseTo(s));
    expect(chimeNotes("workDone", 50, 3)).toHaveLength(6);
  });

  it("くり返しは 1〜5 回に収める", () => {
    expect(repeatStarts(1, 0)).toHaveLength(1);
    expect(repeatStarts(1, 9)).toHaveLength(5);
  });

  it("一覧に無い音を選んでいたら、既定の音にする", () => {
    expect(soundOrDefault("se_bell1", "workDone")).toBe("se_bell1");
    expect(soundOrDefault("chime", "workDone")).toBe("se_oshirase06");
    expect(soundOrDefault("", "breakDone")).toBe("se_pikon5");
  });

  it("配布する版には一覧の音のファイルが全部要り、どの音にも呼び名がある", () => {
    expect(SOUND_FILES).toHaveLength(SOUNDS.length);
    expect(SOUND_FILES).toContain("sounds/se_ka-n01.mp3");
    for (const s of SOUNDS) expect(t(`pomo.sound.${s}`), s).toBeTruthy();
  });
});
