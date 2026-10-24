// 新しい版のお知らせ（起動時の更新の確認）の訳文
import { defineMessages } from ".";

export const { t, tn } = defineMessages({
  ja: {
    failed: "更新できませんでした：{error}",
    label: "新しい版",
    title: "Otosazu {version} が出ています（今は {current}）",
    later: "あとで",
    downloading: "ダウンロード中… {pct}%",
    install: "更新する",
    note: "更新すると Otosazu が一度閉じて、新しい版で開き直します。作業記録はそのまま引き継がれます。計測中のタイマーも止まりません。",
  },
  en: {
    failed: "Couldn't update: {error}",
    label: "New version",
    title: "Otosazu {version} is available (you have {current})",
    later: "Later",
    downloading: "Downloading… {pct}%",
    install: "Update",
    note: "Otosazu will close once and reopen in the new version. Your work log is kept as is, and a running timer won't stop.",
  },
  ko: {
    failed: "업데이트하지 못했습니다: {error}",
    label: "새 버전",
    title: "Otosazu {version}이(가) 나왔습니다(현재 {current})",
    later: "나중에",
    downloading: "다운로드 중… {pct}%",
    install: "업데이트",
    note: "업데이트하면 Otosazu가 한 번 닫히고 새 버전으로 다시 열립니다. 작업 기록은 그대로 이어집니다. 측정 중인 타이머도 멈추지 않습니다.",
  },
  "zh-Hans": {
    failed: "无法更新：{error}",
    label: "新版本",
    title: "Otosazu {version} 已发布（当前为 {current}）",
    later: "以后再说",
    downloading: "正在下载… {pct}%",
    install: "更新",
    note: "更新时 Otosazu 会先关闭，再以新版本重新打开。工作记录会原样保留，正在计时的计时器也不会停止。",
  },
  "zh-Hant": {
    failed: "無法更新：{error}",
    label: "新版本",
    title: "Otosazu {version} 已推出（目前為 {current}）",
    later: "稍後再說",
    downloading: "下載中… {pct}%",
    install: "更新",
    note: "更新時 Otosazu 會先關閉，再以新版本重新開啟。工作紀錄會原樣保留，正在計時的計時器也不會停止。",
  },
});
