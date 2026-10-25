// 遠隔の画面（別端末のブラウザ。仕様書 5.17）だけで使う言葉の訳文。
// タイマーまわりの言葉は timer.ts のものをそのまま使う
import { defineMessages } from ".";

export const { t } = defineMessages({
  ja: {
    work: "作品",
    progress: "進捗",
    loading: "読み込み中…",
    noWorks: "作品がありません",
    startHere: "ここから計測を始める",
    done: "完了",
    waiting: "前の工程待ち",
    offline: "つながりません。PC でアプリが動いているか確かめてください",
  },
  en: {
    work: "Work",
    progress: "Progress",
    loading: "Loading…",
    noWorks: "No works yet",
    startHere: "Start tracking here",
    done: "Done",
    waiting: "Waiting for the previous stage",
    offline: "Cannot connect. Check that the app is running on your PC",
  },
  ko: {
    work: "작품",
    progress: "진행",
    loading: "불러오는 중…",
    noWorks: "작품이 없습니다",
    startHere: "여기서부터 측정 시작",
    done: "완료",
    waiting: "이전 공정 대기",
    offline: "연결할 수 없습니다. PC에서 앱이 실행 중인지 확인해 주세요",
  },
  "zh-Hans": {
    work: "作品",
    progress: "进度",
    loading: "加载中…",
    noWorks: "还没有作品",
    startHere: "从这里开始计时",
    done: "完成",
    waiting: "等待前一道工序",
    offline: "无法连接。请确认电脑上的应用正在运行",
  },
  "zh-Hant": {
    work: "作品",
    progress: "進度",
    loading: "載入中…",
    noWorks: "還沒有作品",
    startHere: "從這裡開始計時",
    done: "完成",
    waiting: "等待前一道工序",
    offline: "無法連線。請確認電腦上的應用程式正在執行",
  },
});
