// 呼び口の振り分け（仕様書 5.17）。別端末のブラウザでは HTTP で呼ぶ
import { beforeEach, describe, expect, it, vi } from "vitest";

/** ブラウザのふりをして api.ts を読み込む。合言葉は URL の ?t= で渡す */
async function loadApi(search: string) {
  vi.resetModules();
  const store = new Map<string, string>();
  vi.stubGlobal("location", { search, pathname: "/" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return await import("./api");
}

function reply(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, text: async () => JSON.stringify(body) });
}

describe("別端末のブラウザからの呼び出し", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("アプリの中ではないと分かる", async () => {
    const { isRemote } = await loadApi("");
    // テストでは window.isTauri が無いので、ブラウザとして扱われる
    expect(isRemote).toBe(true);
  });

  it("コマンドの名前を URL にして POST し、合言葉を添える", async () => {
    const fetchMock = reply({ id: 3, pageId: 7 });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await loadApi("?t=abc123");

    await api.getBoard(5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/cmd/get_board");
    expect(init.method).toBe("POST");
    // 引数の名前は Tauri と同じ camelCase のまま送る
    expect(init.body).toBe(JSON.stringify({ workId: 5 }));
    expect(init.headers["X-Otosazu-Token"]).toBe("abc123");
  });

  it("引数の無いコマンドは空の中身で送る", async () => {
    const fetchMock = reply(null);
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await loadApi("?t=abc123");

    await api.getActiveSession();

    expect(fetchMock.mock.calls[0][0]).toBe("/cmd/get_active_session");
    expect(fetchMock.mock.calls[0][1].body).toBe("{}");
  });

  it("合言葉は localStorage に控え、次からは URL に無くても送る", async () => {
    const fetchMock = reply(null);
    vi.stubGlobal("fetch", fetchMock);
    const first = await loadApi("?t=keep-me");
    await first.api.listWorks();
    expect(fetchMock.mock.calls[0][1].headers["X-Otosazu-Token"]).toBe("keep-me");

    // 同じ localStorage は使い回せないので、控えた値を渡し直して確かめる
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "otosazu.remoteToken" ? "keep-me" : null),
      setItem: () => {},
      removeItem: () => {},
    });
    vi.resetModules();
    vi.stubGlobal("location", { search: "", pathname: "/" });
    const again = await import("./api");
    await again.api.listWorks();
    expect(fetchMock.mock.calls[1][1].headers["X-Otosazu-Token"]).toBe("keep-me");
  });

  it("Rust 側のエラーはそのまま投げ直す", async () => {
    vi.stubGlobal("fetch", reply({ error: "ページのファイルが見つかりません" }, false, 400));
    const { api } = await loadApi("?t=abc123");
    await expect(api.getBoard(5)).rejects.toThrow("ページのファイルが見つかりません");
  });

  it("つながらないときは分かる言葉にする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { api } = await loadApi("?t=abc123");
    await expect(api.listWorks()).rejects.toThrow("PC でアプリが動いているか");
  });

  it("中身の無い失敗は状態の番号で知らせる", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "" }));
    const { api } = await loadApi("");
    await expect(api.listWorks()).rejects.toThrow("HTTP 401");
  });
});
