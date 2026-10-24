// 言語の切り替え（仕様書 5.14）。
// 訳文は画面のまとまりごとに src/i18n/<名前>.ts に置き、defineMessages で 5 言語ぶんを定義する。
// 日本語（ja）が元で、ほかの言語は同じキーをすべて持たないと型エラーになる。
import { Fragment, createElement, ReactNode, useSyncExternalStore } from "react";

export const LANGS = ["ja", "en", "ko", "zh-Hans", "zh-Hant"] as const;
export type Lang = (typeof LANGS)[number];
/** system は OS の言語に合わせる */
export type LangPref = "system" | Lang;

/** 言語の選択肢に出す名前（その言語自身で書く） */
export const LANG_NAMES: Record<Lang, string> = {
  ja: "日本語",
  en: "English",
  ko: "한국어",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

/** 言語タグ（ja-JP、zh-TW など）を対応している言語にする。どれでもなければ英語 */
export function resolveLang(tag: string | undefined): Lang {
  const t = (tag ?? "").toLowerCase();
  if (t.startsWith("ja")) return "ja";
  if (t.startsWith("ko")) return "ko";
  if (t.startsWith("zh")) {
    return /hant|-tw|-hk|-mo/.test(t) ? "zh-Hant" : "zh-Hans";
  }
  return "en";
}

// 起動直後に一瞬別の言語で出ないよう、前回の言語を覚えておいて最初に使う（本当の設定はデータベースにある）
const KEY = "otosazu.lang";
let current: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (LANGS as readonly string[]).includes(v)) return v as Lang;
  } catch {
    // 下で OS の言語を使う
  }
  return resolveLang(typeof navigator === "undefined" ? undefined : navigator.language);
})();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

/** 言語を切り替える。画面は useLang() を使っているところから描き直される */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // 次回の起動で一瞬前の言語になるだけなので無視する
  }
  if (lang === current) return;
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  listeners.forEach((f) => f());
}

/** 今の言語。変わったら描き直す */
export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

/** 訳文。{name} の形で値を差し込む。数によって形が変わる言語（英語の複数形など）は関数で書く */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = string | ((p: any) => string);
type Params = Record<string, string | number>;
type NodeParams = Record<string, ReactNode>;

function fill(msg: Msg, params: Params = {}): string {
  const s = typeof msg === "function" ? msg(params) : msg;
  return s.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

/**
 * 画面のまとまりごとの訳文を定義する。返す t(key, 値) で今の言語の文字列を得る。
 * tn(key, 値) は値に要素（<b> など）を渡せる版で、ReactNode を返す
 */
export function defineMessages<const J extends Record<string, Msg>>(
  messages: { ja: J } & Record<Exclude<Lang, "ja">, Record<keyof J, Msg>>,
) {
  const all = messages as Record<Lang, Record<keyof J, Msg>>;
  function t(key: keyof J, params?: Params): string {
    return fill(all[current][key] ?? all.ja[key], params);
  }
  function tn(key: keyof J, params: NodeParams): ReactNode {
    const msg = all[current][key] ?? all.ja[key];
    const text: string = typeof msg === "function" ? msg(params) : msg;
    const parts = text.split(/\{(\w+)\}/);
    return createElement(
      Fragment,
      null,
      ...parts.map((p, i) => (i % 2 === 1 && p in params ? createElement(Fragment, { key: i }, params[p]) : p)),
    );
  }
  return { t, tn };
}
