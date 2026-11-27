import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearUpdateAttempt, diagnoseUpdate, recordUpdateAttempt, takeFailedUpdate } from "./update-attempt";

describe("更新が終わらなかったことの検出", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("押していなければ何も返さない", () => {
    expect(takeFailedUpdate("3.5.0")).toBeNull();
  });

  it("押した時の版のまま起動したら、入れようとした版を返す。知らせるのは 1 回だけ", () => {
    recordUpdateAttempt("3.5.0", "3.5.2");
    expect(takeFailedUpdate("3.5.0")).toBe("3.5.2");
    expect(takeFailedUpdate("3.5.0")).toBeNull();
  });

  it("新しい版で起動したら失敗ではない", () => {
    recordUpdateAttempt("3.5.0", "3.5.2");
    expect(takeFailedUpdate("3.5.2")).toBeNull();
  });

  it("その場で失敗を知らせて消したら、次の起動では知らせない", () => {
    recordUpdateAttempt("3.5.0", "3.5.2");
    clearUpdateAttempt();
    expect(takeFailedUpdate("3.5.0")).toBeNull();
  });

  it("控えが壊れていても止まらない", () => {
    localStorage.setItem("otosazu.updateAttempt", "{");
    expect(takeFailedUpdate("3.5.0")).toBeNull();
  });
});

describe("インストーラーの記録から、更新がどこで止まったかを読む", () => {
  it("入れようとした版の印が無ければ、動き始める前に止まった", () => {
    expect(diagnoseUpdate(null, "3.9.0")).toBe("notStarted");
    // 前の版を入れたときの記録しか無い
    expect(diagnoseUpdate("start 3.8.0\r\ndone 3.8.0\r\n", "3.9.0")).toBe("notStarted");
  });

  it("動き始めた印だけなら途中で止まり、終わりの印もあれば最後まで終わっている", () => {
    expect(diagnoseUpdate("start 3.9.0\r\n", "3.9.0")).toBe("stopped");
    expect(diagnoseUpdate("start 3.9.0\r\ndone 3.9.0\r\n", "3.9.0")).toBe("installed");
  });

  it("記録が読めなければわからない", () => {
    expect(diagnoseUpdate(undefined, "3.9.0")).toBe("unknown");
  });
});
