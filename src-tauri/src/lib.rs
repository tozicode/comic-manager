mod cmc;

use std::path::Path;

use base64::Engine;

/// サムネイルの最大幅（px）
const THUMBNAIL_WIDTH: u32 = 240;

#[tauri::command]
async fn load_comic(cmc_path: String) -> Result<cmc::Comic, String> {
    cmc::read_comic(Path::new(&cmc_path))
}

/// ページのサムネイルを data URL で返す
#[tauri::command]
async fn load_thumbnail(cmc_path: String, file_name: String) -> Result<String, String> {
    let png = cmc::read_thumbnail(&cmc::page_path(Path::new(&cmc_path), &file_name), THUMBNAIL_WIDTH)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![load_comic, load_thumbnail])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
