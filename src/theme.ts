// 色（ライト／ダーク）の切り替え（仕様書 5.8）。<html data-theme="light|dark"> を切り替え、App.css の変数で色を変える
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isRemote } from "./api";

/** system は OS の設定に合わせる */
export type ThemePref = "system" | "light" | "dark";

// 起動直後に一瞬白く光らないよう、前回の設定を覚えておいて最初に当てる（本当の設定はデータベースにある）
const KEY = "otosazu.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
let pref: ThemePref = loadPref();

function loadPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply() {
  const dark = pref === "dark" || (pref === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** 起動時に、前回の設定で色を当てる。OS の設定が変わったら追いかける */
export function initTheme() {
  apply();
  media.addEventListener("change", () => pref === "system" && apply());
}

/** 設定を当てる（タイトルバーの色も合わせる） */
export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // 次回の起動で一瞬前の色になるだけなので無視する
  }
  apply();
  // 別端末のブラウザには動かせる窓が無い
  if (isRemote) return;
  getCurrentWindow()
    .setTheme(next === "system" ? null : next)
    .catch(() => {});
}
