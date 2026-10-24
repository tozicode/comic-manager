// 漫画ファイル（cmc）の場所を指定し直す流れ（Relink）の訳文
import { defineMessages } from ".";

export const { t, tn } = defineMessages({
  ja: {
    chooseFile: "「{title}」の漫画ファイルを選ぶ",
    filterName: "CLIP STUDIO 漫画ファイル",
    label: "漫画ファイルの場所を指定し直す",
    title: "別の作品のようです",
    cancel: "やめる",
    confirm: "この漫画ファイルにする",
    body: "選んだ漫画ファイル（{file}・{newPages} ページ）は、「{work}」のページと {oldPages} ページ中 {matched}しか一致しませんでした。",
    matchedPages: "{n} ページ",
    note: "このまま進めると、一致しないページの作業記録は「CLIP STUDIO から消えたページ」として残ります（別のページへ移すこともできます）。",
  },
  en: {
    chooseFile: "Choose the comic file for \"{title}\"",
    filterName: "CLIP STUDIO comic file",
    label: "Change comic file location",
    title: "This looks like a different work",
    cancel: "Cancel",
    confirm: "Use this comic file",
    body: (p) =>
      `The comic file you chose ({file}, ${p.newPages === 1 ? "1 page" : "{newPages} pages"}) matches only {matched} of the ${
        p.oldPages === 1 ? "1 page" : "{oldPages} pages"
      } in "{work}".`,
    matchedPages: (p) => (p.n === 1 ? "1 page" : "{n} pages"),
    note: "If you continue, work logs for pages that don't match will stay under \"Pages gone from CLIP STUDIO\" (you can also move them to other pages).",
  },
  ko: {
    chooseFile: "'{title}'의 만화 파일 선택",
    filterName: "CLIP STUDIO 만화 파일",
    label: "만화 파일 위치 다시 지정",
    title: "다른 작품인 것 같습니다",
    cancel: "취소",
    confirm: "이 만화 파일로 지정",
    body: "선택한 만화 파일({file}·{newPages}페이지)은 '{work}'의 {oldPages}페이지 중 {matched}만 일치합니다.",
    matchedPages: "{n}페이지",
    note: "이대로 진행하면 일치하지 않는 페이지의 작업 기록은 'CLIP STUDIO에서 사라진 페이지'로 남습니다(다른 페이지로 옮길 수도 있습니다).",
  },
  "zh-Hans": {
    chooseFile: "选择“{title}”的漫画文件",
    filterName: "CLIP STUDIO 漫画文件",
    label: "重新指定漫画文件的位置",
    title: "这似乎是另一部作品",
    cancel: "取消",
    confirm: "使用此漫画文件",
    body: "所选的漫画文件（{file}，{newPages} 页）与“{work}”的 {oldPages} 页中只有 {matched}一致。",
    matchedPages: "{n} 页",
    note: "如果继续，不一致页面的工作记录会作为“已从 CLIP STUDIO 中消失的页面”保留（也可以移到其他页面）。",
  },
  "zh-Hant": {
    chooseFile: "選擇「{title}」的漫畫檔案",
    filterName: "CLIP STUDIO 漫畫檔案",
    label: "重新指定漫畫檔案的位置",
    title: "這似乎是另一部作品",
    cancel: "取消",
    confirm: "使用此漫畫檔案",
    body: "所選的漫畫檔案（{file}，{newPages} 頁）與「{work}」的 {oldPages} 頁中只有 {matched}一致。",
    matchedPages: "{n} 頁",
    note: "如果繼續，不一致頁面的工作紀錄會以「已從 CLIP STUDIO 中消失的頁面」保留（也可以移到其他頁面）。",
  },
});
