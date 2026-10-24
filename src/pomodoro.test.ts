import { describe, expect, it } from "vitest";
import { haltPomo, pomoClock, initialPomo, keepGoing, remainingMs, runPomo, SNOOZE_MS, takeBreak, tickPomo, workedMs } from "./pomodoro";

const MIN = 60_000;
const S = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };
const DAY = "2026-10-24";
const T0 = 1_000_000_000_000;

describe("ポモドーロ", () => {
  it("計測している間だけ数え、作業の時間になったら知らせる", () => {
    let p = runPomo(initialPomo(DAY, S), T0, DAY, S);
    expect(tickPomo(p, T0 + 24 * MIN).event).toBeNull();
    expect(remainingMs(p, T0 + 24 * MIN)).toBe(1 * MIN);
    const r = tickPomo(p, T0 + 25 * MIN);
    expect(r.event).toBe("workDone");
    p = r.pomo;
    expect(p.phase).toBe("due");
    // 知らせるのは 1 回だけ
    expect(tickPomo(p, T0 + 26 * MIN).event).toBeNull();
  });

  it("短い一時停止では残り時間が止まるだけ", () => {
    let p = runPomo(initialPomo(DAY, S), T0, DAY, S);
    p = haltPomo(p, T0 + 10 * MIN);
    expect(workedMs(p, T0 + 13 * MIN)).toBe(10 * MIN);
    p = runPomo(p, T0 + 13 * MIN, DAY, S);
    expect(workedMs(p, T0 + 20 * MIN)).toBe(17 * MIN);
  });

  it("休憩の長さ以上止めていたら、新しいポモドーロにする", () => {
    let p = runPomo(initialPomo(DAY, S), T0, DAY, S);
    p = haltPomo(p, T0 + 10 * MIN);
    p = runPomo(p, T0 + 15 * MIN, DAY, S);
    expect(workedMs(p, T0 + 15 * MIN)).toBe(0);
    expect(p.count).toBe(0);
  });

  it("計測中のまま別のタスクに切り替えても数え続ける", () => {
    const p = runPomo(initialPomo(DAY, S), T0, DAY, S);
    expect(runPomo(p, T0 + 5 * MIN, DAY, S)).toBe(p);
  });

  it("休憩して、終わったら知らせ、再開で次のポモドーロ", () => {
    let p = tickPomo(runPomo(initialPomo(DAY, S), T0, DAY, S), T0 + 25 * MIN).pomo;
    p = takeBreak(p, T0 + 26 * MIN, S);
    expect(p.phase).toBe("break");
    expect(p.long).toBe(false);
    expect(remainingMs(p, T0 + 27 * MIN)).toBe(4 * MIN);
    const r = tickPomo(p, T0 + 31 * MIN);
    expect(r.event).toBe("breakDone");
    p = runPomo(r.pomo, T0 + 33 * MIN, DAY, S);
    expect(p.phase).toBe("work");
    expect(remainingMs(p, T0 + 33 * MIN)).toBe(25 * MIN);
  });

  it("休憩中に計測を始めたら、休憩を終えて次のポモドーロ", () => {
    let p = takeBreak(runPomo(initialPomo(DAY, S), T0, DAY, S), T0 + 25 * MIN, S);
    p = runPomo(p, T0 + 27 * MIN, DAY, S);
    expect(p.phase).toBe("work");
    expect(tickPomo(p, T0 + 30 * MIN).event).toBeNull();
  });

  it("4 回目ごとは長い休憩", () => {
    let p = initialPomo(DAY, S);
    const longs: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      p = takeBreak(runPomo(p, T0, DAY, S), T0, S);
      longs.push(p.long);
    }
    expect(longs).toEqual([false, false, false, true]);
    expect(p.breakEnd - T0).toBe(15 * MIN);
  });

  it("続けるを押すと、少ししてからもう一度知らせる", () => {
    let p = tickPomo(runPomo(initialPomo(DAY, S), T0, DAY, S), T0 + 25 * MIN).pomo;
    p = keepGoing(p, T0 + 26 * MIN);
    expect(tickPomo(p, T0 + 26 * MIN + SNOOZE_MS - 1).event).toBeNull();
    expect(tickPomo(p, T0 + 26 * MIN + SNOOZE_MS).event).toBe("workDone");
  });

  it("日が変わったら回数を 0 に戻す", () => {
    let p = takeBreak(runPomo(initialPomo(DAY, S), T0, DAY, S), T0, S);
    expect(p.count).toBe(1);
    p = runPomo(p, T0 + 600 * MIN, "2026-10-25", S);
    expect(p.count).toBe(0);
    expect(p.day).toBe("2026-10-25");
  });
});

describe("pomoClock", () => {
  it("1 時間未満は分と秒、それ以上は時も出す", () => {
    expect(pomoClock(25 * MIN)).toBe("25:00");
    expect(pomoClock(4 * MIN + 1500)).toBe("4:02");
    expect(pomoClock(65 * MIN)).toBe("1:05:00");
  });
});
