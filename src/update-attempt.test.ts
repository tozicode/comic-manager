import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearUpdateAttempt, recordUpdateAttempt, takeFailedUpdate } from "./update-attempt";

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
