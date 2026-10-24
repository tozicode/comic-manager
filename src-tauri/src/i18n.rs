//! 言語の切り替え（仕様書 5.14）。画面に返すエラーメッセージと、初回起動時に作る工程・タグの名前を訳す。
//! 言語は設定（表示の設定の language）で決まり、"system" なら OS の言語に合わせる。

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ja = 0,
    En = 1,
    Ko = 2,
    ZhHans = 3,
    ZhHant = 4,
}

impl Lang {
    /// 設定や画面とやりとりする名前（ja / en / ko / zh-Hans / zh-Hant）
    pub fn code(self) -> &'static str {
        match self {
            Lang::Ja => "ja",
            Lang::En => "en",
            Lang::Ko => "ko",
            Lang::ZhHans => "zh-Hans",
            Lang::ZhHant => "zh-Hant",
        }
    }

    /// 言語タグ（ja-JP、zh-TW など）を対応している言語にする。どれでもなければ英語
    pub fn resolve(tag: &str) -> Lang {
        let t = tag.to_ascii_lowercase();
        if t.starts_with("ja") {
            Lang::Ja
        } else if t.starts_with("ko") {
            Lang::Ko
        } else if t.starts_with("zh") {
            if ["hant", "-tw", "-hk", "-mo", "_tw", "_hk", "_mo"].iter().any(|s| t.contains(s)) {
                Lang::ZhHant
            } else {
                Lang::ZhHans
            }
        } else {
            Lang::En
        }
    }

    /// OS の言語
    pub fn system() -> Lang {
        sys_locale::get_locale().map(|l| Lang::resolve(&l)).unwrap_or(Lang::En)
    }

    /// 設定の値（"system" または言語の名前）から言語を決める
    pub fn from_pref(pref: &str) -> Lang {
        if pref == "system" { Lang::system() } else { Lang::resolve(pref) }
    }
}

static CURRENT: AtomicU8 = AtomicU8::new(Lang::Ja as u8);

pub fn set(lang: Lang) {
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

pub fn current() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::Ko,
        3 => Lang::ZhHans,
        4 => Lang::ZhHant,
        _ => Lang::Ja,
    }
}

/// 訳文の表。[日本語, 英語, 韓国語, 簡体字, 繁体字] の順に書く。{name} は trf で差し込む
macro_rules! messages {
    ($($key:ident => [$ja:expr, $en:expr, $ko:expr, $hans:expr, $hant:expr $(,)?],)*) => {
        #[derive(Debug, Clone, Copy)]
        pub enum M { $($key,)* }

        /// 今の言語の訳文
        pub fn tr(m: M) -> &'static str {
            let i = current() as usize;
            match m { $(M::$key => [$ja, $en, $ko, $hans, $hant][i],)* }
        }
    };
}

/// 訳文に値を差し込む（{name} を置き換える）
pub fn trf(m: M, params: &[(&str, &dyn std::fmt::Display)]) -> String {
    let mut s = tr(m).to_string();
    for (name, value) in params {
        s = s.replace(&format!("{{{name}}}"), &value.to_string());
    }
    s
}

messages! {
    DbBusy => [
        "データベースが使えない状態です",
        "The database is not available",
        "데이터베이스를 사용할 수 없는 상태입니다",
        "数据库当前无法使用",
        "資料庫目前無法使用",
    ],
    DbError => [
        "データベースの操作に失敗しました: {e}",
        "Database operation failed: {e}",
        "데이터베이스 작업에 실패했습니다: {e}",
        "数据库操作失败：{e}",
        "資料庫操作失敗：{e}",
    ],
    DataDirCreateFailed => [
        "データの保存先を作れませんでした: {e}",
        "Couldn't create the data folder: {e}",
        "데이터 저장 위치를 만들 수 없습니다: {e}",
        "无法创建数据保存位置：{e}",
        "無法建立資料儲存位置：{e}",
    ],
    MigrationBroken => [
        "データの更新で不整合が見つかりました。バックアップから戻してください",
        "An inconsistency was found while updating the data. Please restore from a backup",
        "데이터를 업데이트하는 중 불일치가 발견되었습니다. 백업에서 복원해 주세요",
        "更新数据时发现不一致。请从备份恢复",
        "更新資料時發現不一致。請從備份還原",
    ],

    // ----- 工程 -----
    StageNotFound => [
        "工程が見つかりませんでした",
        "Stage not found",
        "공정을 찾을 수 없습니다",
        "找不到工序",
        "找不到工序",
    ],
    HintTooShort => [
        "目安の時間は 1 分以上にしてください",
        "Estimated time must be at least 1 minute",
        "예상 시간은 1분 이상으로 설정해 주세요",
        "参考时间请设为 1 分钟以上",
        "參考時間請設為 1 分鐘以上",
    ],
    KeepOneStage => [
        "工程は 1 つ以上表示しておく必要があります",
        "At least one stage must stay visible",
        "공정은 1개 이상 표시해야 합니다",
        "至少需要显示 1 个工序",
        "至少需要顯示 1 個工序",
    ],
    StageOrderInvalid => [
        "工程の並びが正しくありません",
        "Invalid stage order",
        "공정 순서가 올바르지 않습니다",
        "工序顺序不正确",
        "工序順序不正確",
    ],
    SetHasNoVisibleStage => [
        "選んだ工程のセットに、表示している工程がありません",
        "The selected stage set has no visible stages",
        "선택한 공정 세트에 표시된 공정이 없습니다",
        "所选工序组中没有显示的工序",
        "所選工序組中沒有顯示的工序",
    ],

    // ----- 作品 -----
    WorkNotFound => [
        "作品が見つかりませんでした",
        "Work not found",
        "작품을 찾을 수 없습니다",
        "找不到作品",
        "找不到作品",
    ],
    CmcAlreadyAdded => [
        "この漫画ファイルはすでに登録されています",
        "This comic file has already been added",
        "이 만화 파일은 이미 등록되어 있습니다",
        "该漫画文件已添加",
        "此漫畫檔案已新增",
    ],
    CmcRegisteredAs => [
        "この漫画ファイルは「{title}」として登録されています。そちらを作品一覧から外してから、もう一度選んでください",
        "This comic file is already added as \"{title}\". Remove that work from the list, then select the file again",
        "이 만화 파일은 '{title}'(으)로 등록되어 있습니다. 그 작품을 작품 목록에서 제외한 뒤 다시 선택해 주세요",
        "该漫画文件已作为“{title}”添加。请先从作品列表中移除该作品，再重新选择",
        "此漫畫檔案已作為「{title}」新增。請先從作品清單中移除該作品，再重新選擇",
    ],
    CmcMissing => [
        "漫画ファイルが見つかりません（前の場所：{path}）",
        "Comic file not found (previous location: {path})",
        "만화 파일을 찾을 수 없습니다(이전 위치: {path})",
        "找不到漫画文件（之前的位置：{path}）",
        "找不到漫畫檔案（之前的位置：{path}）",
    ],
    IllustNeedsFiles => [
        "イラストの作品は、ファイルごとに場所を指定してください",
        "For illustration works, set the location of each file",
        "일러스트 작품은 파일마다 위치를 지정해 주세요",
        "插画作品请为每个文件指定位置",
        "插畫作品請為每個檔案指定位置",
    ],

    // ----- 計測・作業記録 -----
    TrackingStartFailed => [
        "計測を開始できませんでした",
        "Couldn't start tracking",
        "측정을 시작할 수 없습니다",
        "无法开始计时",
        "無法開始計時",
    ],
    PageOrStageNotFound => [
        "ページか工程が見つかりませんでした",
        "Page or stage not found",
        "페이지 또는 공정을 찾을 수 없습니다",
        "找不到页或工序",
        "找不到頁或工序",
    ],
    SessionNotFound => [
        "作業記録が見つかりませんでした",
        "Work log entry not found",
        "작업 기록을 찾을 수 없습니다",
        "找不到工作记录",
        "找不到工作紀錄",
    ],
    RunningSessionEnd => [
        "計測中の記録の終了時刻は変えられません",
        "You can't change the end time of an entry that is still being tracked",
        "측정 중인 기록의 종료 시각은 변경할 수 없습니다",
        "无法更改计时中记录的结束时间",
        "無法變更計時中紀錄的結束時間",
    ],
    StartInFuture => [
        "開始時刻が未来になっています",
        "The start time is in the future",
        "시작 시각이 미래로 되어 있습니다",
        "开始时间晚于当前时间",
        "開始時間晚於目前時間",
    ],
    EndBeforeStart => [
        "終了時刻は開始時刻より後にしてください",
        "The end time must be after the start time",
        "종료 시각은 시작 시각보다 뒤로 설정해 주세요",
        "结束时间必须晚于开始时间",
        "結束時間必須晚於開始時間",
    ],
    EndInFuture => [
        "終了時刻が未来になっています",
        "The end time is in the future",
        "종료 시각이 미래로 되어 있습니다",
        "结束时间晚于当前时间",
        "結束時間晚於目前時間",
    ],

    // ----- バックアップ -----
    ReplaceFileFailed => [
        "同じ名前のファイルを置き換えられませんでした: {e}",
        "Couldn't replace the file with the same name: {e}",
        "같은 이름의 파일을 바꿀 수 없습니다: {e}",
        "无法替换同名文件：{e}",
        "無法取代同名檔案：{e}",
    ],
    BackupFailed => [
        "バックアップを作れませんでした: {e}",
        "Couldn't create the backup: {e}",
        "백업을 만들 수 없습니다: {e}",
        "无法创建备份：{e}",
        "無法建立備份：{e}",
    ],
    // ----- カレンダーへの書き出し -----
    CalendarSaveFailed => [
        "カレンダーのファイルを保存できませんでした: {e}",
        "Couldn't save the calendar file: {e}",
        "캘린더 파일을 저장할 수 없습니다: {e}",
        "无法保存日历文件：{e}",
        "無法儲存行事曆檔案：{e}",
    ],
    PrintFailed => [
        "印刷できませんでした: {e}",
        "Couldn't print: {e}",
        "인쇄할 수 없습니다: {e}",
        "无法打印：{e}",
        "無法列印：{e}",
    ],
    OpenDataDirFailed => [
        "保存場所を開けませんでした: {e}",
        "Couldn't open the save location: {e}",
        "저장 위치를 열 수 없습니다: {e}",
        "无法打开保存位置：{e}",
        "無法開啟儲存位置：{e}",
    ],

    // ----- 名前・タグ -----
    NameRequired => [
        "名前を入力してください",
        "Enter a name",
        "이름을 입력해 주세요",
        "请输入名称",
        "請輸入名稱",
    ],
    TagNotFound => [
        "タグが見つかりませんでした",
        "Tag not found",
        "태그를 찾을 수 없습니다",
        "找不到标签",
        "找不到標籤",
    ],
    TagSetAutomatically => [
        "このタグは CLIP STUDIO の設定から自動で付きます",
        "This tag is added automatically from the CLIP STUDIO settings",
        "이 태그는 CLIP STUDIO 설정에 따라 자동으로 붙습니다",
        "此标签会根据 CLIP STUDIO 的设置自动添加",
        "此標籤會依 CLIP STUDIO 的設定自動加上",
    ],
    TagGroupLocked => [
        "このグループにはタグを追加できません",
        "You can't add tags to this group",
        "이 그룹에는 태그를 추가할 수 없습니다",
        "无法向此组添加标签",
        "無法在此群組新增標籤",
    ],
    AppliesInvalid => [
        "使う作品の種類の指定が正しくありません",
        "Invalid work type",
        "사용할 작품 종류의 지정이 올바르지 않습니다",
        "适用的作品类型不正确",
        "適用的作品類型不正確",
    ],
    FactorRange => [
        "倍率は ×0.1 〜 ×10 の範囲にしてください",
        "The multiplier must be between ×0.1 and ×10",
        "배율은 ×0.1~×10 범위로 설정해 주세요",
        "倍率请设在 ×0.1 ~ ×10 之间",
        "倍率請設在 ×0.1 ~ ×10 之間",
    ],

    // ----- スケジュール・設定 -----
    WorkOrderInvalid => [
        "作業順の指定が正しくありません",
        "Invalid work order",
        "작업 순서 지정이 올바르지 않습니다",
        "工作顺序不正确",
        "工作順序不正確",
    ],
    DayStartRange => [
        "1 日の区切りは 0〜12 時にしてください",
        "The day start time must be between 0:00 and 12:00",
        "하루 시작 시각은 0~12시로 설정해 주세요",
        "一天的分界时间请设在 0~12 点之间",
        "一天的分界時間請設在 0~12 點之間",
    ],
    HoursRange => [
        "作業時間は 0〜24 時間の範囲にしてください",
        "Working time must be between 0 and 24 hours",
        "작업 시간은 0~24시간 범위로 설정해 주세요",
        "工作时间请设在 0~24 小时之间",
        "工作時間請設在 0~24 小時之間",
    ],
    DateFormatInvalid => [
        "日付の形式が正しくありません",
        "Invalid date format",
        "날짜 형식이 올바르지 않습니다",
        "日期格式不正确",
        "日期格式不正確",
    ],
    IdleMinutesRange => [
        "確認するまでの時間は 0〜240 分にしてください",
        "The time before checking must be between 0 and 240 minutes",
        "확인까지의 시간은 0~240분으로 설정해 주세요",
        "确认前的时间请设在 0~240 分钟之间",
        "確認前的時間請設在 0~240 分鐘之間",
    ],
    PomodoroRange => [
        "ポモドーロの時間は 1〜180 分、長い休憩までの回数は 1〜12 回で指定してください",
        "Pomodoro times must be 1–180 minutes, and the number before a long break 1–12",
        "뽀모도로 시간은 1~180분, 긴 휴식까지의 횟수는 1~12회로 지정하세요",
        "番茄钟的时间请设为 1～180 分钟，长休息前的次数请设为 1～12 次",
        "番茄鐘的時間請設為 1～180 分鐘，長休息前的次數請設為 1～12 次",
    ],
    TimeFormatInvalid => [
        "時間の表記の指定が正しくありません",
        "Invalid time format",
        "시간 표기 지정이 올바르지 않습니다",
        "时间显示格式不正确",
        "時間顯示格式不正確",
    ],
    ThemeInvalid => [
        "色の指定が正しくありません",
        "Invalid color theme",
        "색상 지정이 올바르지 않습니다",
        "颜色设置不正确",
        "色彩設定不正確",
    ],
    LanguageInvalid => [
        "言語の指定が正しくありません",
        "Invalid language",
        "언어 지정이 올바르지 않습니다",
        "语言设置不正确",
        "語言設定不正確",
    ],

    // ----- ページ -----
    MergeSamePage => [
        "同じページにはまとめられません",
        "You can't merge a page into itself",
        "같은 페이지로는 합칠 수 없습니다",
        "无法合并到同一页",
        "無法合併到同一頁",
    ],
    MergeOtherWork => [
        "別の作品のページにはまとめられません",
        "You can't merge into a page of another work",
        "다른 작품의 페이지로는 합칠 수 없습니다",
        "无法合并到其他作品的页",
        "無法合併到其他作品的頁",
    ],

    // ----- イラストのファイル -----
    UnsupportedFile => [
        "{name} は登録できない種類のファイルです（.clip / .psd を選んでください）",
        "{name} is not a supported file type (choose a .clip or .psd file)",
        "{name}은(는) 등록할 수 없는 종류의 파일입니다(.clip / .psd 파일을 선택해 주세요)",
        "{name} 是无法添加的文件类型（请选择 .clip / .psd）",
        "{name} 是無法新增的檔案類型（請選擇 .clip / .psd）",
    ],
    NoFilesSelected => [
        "ファイルを 1 つ以上選んでください",
        "Choose at least one file",
        "파일을 1개 이상 선택해 주세요",
        "请至少选择 1 个文件",
        "請至少選擇 1 個檔案",
    ],
    LastFile => [
        "最後のファイルは外せません（作品ごと外すときは作品一覧から）",
        "You can't remove the last file (to remove the whole work, use the work list)",
        "마지막 파일은 제외할 수 없습니다(작품 전체를 제외하려면 작품 목록에서)",
        "无法移除最后一个文件（要移除整个作品，请在作品列表中操作）",
        "無法移除最後一個檔案（要移除整個作品，請在作品清單中操作）",
    ],
    FileOrderInvalid => [
        "ファイルの並びが正しくありません",
        "Invalid file order",
        "파일 순서가 올바르지 않습니다",
        "文件顺序不正确",
        "檔案順序不正確",
    ],
    FileAlreadyAdded => [
        "このファイルは同じ作品にすでに登録されています",
        "This file has already been added to this work",
        "이 파일은 이미 같은 작품에 등록되어 있습니다",
        "该文件已添加到此作品中",
        "此檔案已新增至此作品",
    ],
    FileNotFound => [
        "ファイルが見つかりませんでした",
        "File not found",
        "파일을 찾을 수 없습니다",
        "找不到文件",
        "找不到檔案",
    ],
    IllustOnly => [
        "この操作はイラストの作品でだけ使えます",
        "This action is only available for illustration works",
        "이 작업은 일러스트 작품에서만 사용할 수 있습니다",
        "此操作仅适用于插画作品",
        "此操作僅適用於插畫作品",
    ],

    // ----- ファイルの読み込み（cmc / clip / psd） -----
    CmcOpenFailed => [
        "漫画ファイルを開けませんでした（{path}）: {e}",
        "Couldn't open the comic file ({path}): {e}",
        "만화 파일을 열 수 없습니다({path}): {e}",
        "无法打开漫画文件（{path}）：{e}",
        "無法開啟漫畫檔案（{path}）：{e}",
    ],
    PageFileNotFound => [
        "ページファイルが見つかりませんでした: {e}",
        "Page file not found: {e}",
        "페이지 파일을 찾을 수 없습니다: {e}",
        "找不到页面文件：{e}",
        "找不到頁面檔案：{e}",
    ],
    ThumbNotFound => [
        "サムネイルが見つかりませんでした: {e}",
        "Thumbnail not found: {e}",
        "썸네일을 찾을 수 없습니다: {e}",
        "找不到缩略图：{e}",
        "找不到縮圖：{e}",
    ],
    ThumbReadFailed => [
        "サムネイルを読み込めませんでした: {e}",
        "Couldn't load the thumbnail: {e}",
        "썸네일을 불러올 수 없습니다: {e}",
        "无法读取缩略图：{e}",
        "無法讀取縮圖：{e}",
    ],
    ThumbConvertFailed => [
        "サムネイルを変換できませんでした: {e}",
        "Couldn't convert the thumbnail: {e}",
        "썸네일을 변환할 수 없습니다: {e}",
        "无法转换缩略图：{e}",
        "無法轉換縮圖：{e}",
    ],
    NoThumbnail => [
        "サムネイルが入っていませんでした",
        "The file has no thumbnail",
        "썸네일이 들어 있지 않습니다",
        "文件中没有缩略图",
        "檔案中沒有縮圖",
    ],
    ImageReadFailed => [
        "画像ファイルを読めませんでした（{path}）: {e}",
        "Couldn't read the image file ({path}): {e}",
        "이미지 파일을 읽을 수 없습니다({path}): {e}",
        "无法读取图像文件（{path}）：{e}",
        "無法讀取圖片檔案（{path}）：{e}",
    ],
    NotPsd => [
        "Photoshop 形式（.psd）のファイルではありません",
        "Not a Photoshop (.psd) file",
        "Photoshop 형식(.psd) 파일이 아닙니다",
        "不是 Photoshop 格式（.psd）的文件",
        "不是 Photoshop 格式（.psd）的檔案",
    ],
    ImageResourceTooLarge => [
        "画像リソースが大きすぎます",
        "The image resources are too large",
        "이미지 리소스가 너무 큽니다",
        "图像资源过大",
        "圖片資源過大",
    ],
    PageListUnsupported => [
        "ページ一覧を読めませんでした（対応していない形式の可能性があります）: {e}",
        "Couldn't read the page list (the format may not be supported): {e}",
        "페이지 목록을 읽을 수 없습니다(지원하지 않는 형식일 수 있습니다): {e}",
        "无法读取页面列表（可能是不支持的格式）：{e}",
        "無法讀取頁面清單（可能是不支援的格式）：{e}",
    ],
    PageListReadFailed => [
        "ページ一覧を読めませんでした: {e}",
        "Couldn't read the page list: {e}",
        "페이지 목록을 읽을 수 없습니다: {e}",
        "无法读取页面列表：{e}",
        "無法讀取頁面清單：{e}",
    ],
    PageFileReadFailed => [
        "ページファイルを読めませんでした（{path}）: {e}",
        "Couldn't read the page file ({path}): {e}",
        "페이지 파일을 읽을 수 없습니다({path}): {e}",
        "无法读取页面文件（{path}）：{e}",
        "無法讀取頁面檔案（{path}）：{e}",
    ],
    NotClipPageFile => [
        "CLIP STUDIO のページファイルではありません",
        "Not a CLIP STUDIO page file",
        "CLIP STUDIO 페이지 파일이 아닙니다",
        "不是 CLIP STUDIO 的页面文件",
        "不是 CLIP STUDIO 的頁面檔案",
    ],
    PageDbNotFound => [
        "ページファイル内にデータベースが見つかりませんでした",
        "No database was found in the page file",
        "페이지 파일 안에서 데이터베이스를 찾을 수 없습니다",
        "在页面文件中找不到数据库",
        "在頁面檔案中找不到資料庫",
    ],
    TempCreateFailed => [
        "一時ファイルを作れませんでした: {e}",
        "Couldn't create a temporary file: {e}",
        "임시 파일을 만들 수 없습니다: {e}",
        "无法创建临时文件：{e}",
        "無法建立暫存檔案：{e}",
    ],
    TempWriteFailed => [
        "一時ファイルに書き込めませんでした: {e}",
        "Couldn't write to a temporary file: {e}",
        "임시 파일에 쓸 수 없습니다: {e}",
        "无法写入临时文件：{e}",
        "無法寫入暫存檔案：{e}",
    ],
    DbOpenUnsupported => [
        "データベースとして開けませんでした（対応していない形式の可能性があります）: {e}",
        "Couldn't open it as a database (the format may not be supported): {e}",
        "데이터베이스로 열 수 없습니다(지원하지 않는 형식일 수 있습니다): {e}",
        "无法作为数据库打开（可能是不支持的格式）：{e}",
        "無法作為資料庫開啟（可能是不支援的格式）：{e}",
    ],

    // ----- 窓・ショートカット -----
    MiniTitle => [
        "Otosazu ミニタイマー",
        "Otosazu mini timer",
        "Otosazu 미니 타이머",
        "Otosazu 迷你计时器",
        "Otosazu 迷你計時器",
    ],
    MiniNotOpen => [
        "ミニタイマー窓が開いていません",
        "The mini timer window is not open",
        "미니 타이머 창이 열려 있지 않습니다",
        "迷你计时器窗口未打开",
        "迷你計時器視窗未開啟",
    ],
    MainWindowNotFound => [
        "メインの窓が見つかりません",
        "Main window not found",
        "메인 창을 찾을 수 없습니다",
        "找不到主窗口",
        "找不到主視窗",
    ],
    WindowOpFailed => [
        "窓の操作に失敗しました: {e}",
        "Window operation failed: {e}",
        "창 작업에 실패했습니다: {e}",
        "窗口操作失败：{e}",
        "視窗操作失敗：{e}",
    ],
    ShortcutInvalid => [
        "「{shortcut}」はショートカットとして使えません",
        "\"{shortcut}\" can't be used as a shortcut",
        "'{shortcut}'은(는) 단축키로 사용할 수 없습니다",
        "“{shortcut}”无法用作快捷键",
        "「{shortcut}」無法用作快捷鍵",
    ],
    ShortcutRegisterFailed => [
        "ショートカットを登録できませんでした（他のアプリが使っているかもしれません）: {e}",
        "Couldn't register the shortcut (another app may be using it): {e}",
        "단축키를 등록할 수 없습니다(다른 앱에서 사용 중일 수 있습니다): {e}",
        "无法注册快捷键（可能已被其他应用占用）：{e}",
        "無法註冊快捷鍵（可能已被其他應用程式使用）：{e}",
    ],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 言語タグを対応している言語にする() {
        assert_eq!(Lang::resolve("ja-JP"), Lang::Ja);
        assert_eq!(Lang::resolve("en-US"), Lang::En);
        assert_eq!(Lang::resolve("ko-KR"), Lang::Ko);
        assert_eq!(Lang::resolve("zh-CN"), Lang::ZhHans);
        assert_eq!(Lang::resolve("zh-Hans-CN"), Lang::ZhHans);
        assert_eq!(Lang::resolve("zh-TW"), Lang::ZhHant);
        assert_eq!(Lang::resolve("zh-Hant-HK"), Lang::ZhHant);
        assert_eq!(Lang::resolve("fr-FR"), Lang::En);
        assert_eq!(Lang::from_pref("ko"), Lang::Ko);
    }

    #[test]
    fn 値を差し込む() {
        // 言語はテスト全体で共有しているので、ここでは日本語のまま確かめる
        assert_eq!(trf(M::DbBusy, &[("x", &1)]), "データベースが使えない状態です");
    }
}
