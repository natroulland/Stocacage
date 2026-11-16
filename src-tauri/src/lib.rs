use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    Manager,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_positioner::{Position, WindowExt};

static FIRST_OPEN: AtomicBool = AtomicBool::new(true);

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct VaultImage {
    pub name: String,
    pub path: String,
    pub media_type: String, // "image" or "video"
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct VaultFolder {
    pub name: String,
    pub path: String,
    pub count: usize,
}

fn detect_media_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 4 && &bytes[0..4] == b"\x89PNG" {
        Some("png")
    } else if bytes.len() >= 3 && &bytes[0..3] == b"\xFF\xD8\xFF" {
        Some("jpg")
    } else if bytes.len() >= 4 && &bytes[0..4] == b"GIF8" {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.len() >= 2 && &bytes[0..2] == b"BM" {
        Some("bmp")
    } else if bytes.len() >= 4 && &bytes[4..8] == b"ftyp" {
        Some("mp4")
    } else if bytes.len() >= 4 && &bytes[0..4] == b"\x1aE\xdf\xa3" {
        Some("webm")
    } else {
        None
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct AppConfig {
    pub vault_path: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct VaultConfigInfo {
    pub is_configured: bool,
    pub current_path: String,
    pub default_path: String,
}

fn get_config_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_data.exists() {
        let _ = std::fs::create_dir_all(&app_data);
    }
    Ok(app_data.join("config.json"))
}

fn load_app_config(app: &tauri::AppHandle) -> AppConfig {
    if let Ok(config_file) = get_config_file(app) {
        if config_file.exists() {
            if let Ok(data) = std::fs::read_to_string(config_file) {
                if let Ok(cfg) = serde_json::from_str::<AppConfig>(&data) {
                    return cfg;
                }
            }
        }
    }
    AppConfig::default()
}

fn save_app_config(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let config_file = get_config_file(app)?;
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_file, data).map_err(|e| e.to_string())
}

fn get_default_vault_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    Ok(desktop.join("stocacageVault"))
}

fn get_vault_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let config = load_app_config(app);
    let vault = if let Some(ref p) = config.vault_path {
        std::path::PathBuf::from(p)
    } else {
        get_default_vault_path(app)?
    };
    if !vault.exists() {
        std::fs::create_dir_all(&vault).map_err(|e| e.to_string())?;
    }
    Ok(vault)
}

fn is_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico")
}

fn is_video_ext(ext: &str) -> bool {
    matches!(ext, "mp4" | "webm" | "mov" | "mkv" | "avi" | "m4v")
}

fn is_media_ext(ext: &str) -> bool {
    is_image_ext(ext) || is_video_ext(ext)
}

#[tauri::command]
fn get_vault_config(app: tauri::AppHandle) -> Result<VaultConfigInfo, String> {
    let config = load_app_config(&app);
    let default_p = get_default_vault_path(&app)?;
    let default_str = default_p.to_string_lossy().to_string();
    let is_configured = config.vault_path.is_some();
    let current_path = config.vault_path.unwrap_or_else(|| default_str.clone());
    Ok(VaultConfigInfo {
        is_configured,
        current_path,
        default_path: default_str,
    })
}

#[tauri::command]
fn set_vault_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }
    let config = AppConfig {
        vault_path: Some(path.clone()),
    };
    save_app_config(&app, &config)?;
    Ok(path)
}

#[tauri::command]
fn select_folder_dialog() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Sélectionnez le dossier de stockage de vos médias")
        .pick_folder();

    if let Some(f) = folder {
        Ok(Some(f.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(window) = app
        .get_webview_window("stocacage")
        .or_else(|| app.get_webview_window("main"))
    {
        let _ = window.hide();
    }
}

#[tauri::command]
fn open_vault_folder(app: tauri::AppHandle, folder: Option<String>) -> Result<(), String> {
    let vault = get_vault_root(&app)?;
    let target = if let Some(f) = folder {
        vault.join(&f)
    } else {
        vault
    };
    if !target.exists() {
        let _ = std::fs::create_dir_all(&target);
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_vault_image(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn collect_media_recursive(dir: &std::path::Path, images: &mut Vec<VaultImage>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if is_media_ext(&ext) {
                    let name = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let path_str = path.to_string_lossy().to_string();
                    let media_type = if is_video_ext(&ext) {
                        "video".to_string()
                    } else {
                        "image".to_string()
                    };
                    images.push(VaultImage { name, path: path_str, media_type });
                }
            } else if path.is_dir() {
                collect_media_recursive(&path, images);
            }
        }
    }
}

#[tauri::command]
fn get_vault_images(app: tauri::AppHandle, folder: Option<String>) -> Result<Vec<VaultImage>, String> {
    let vault = get_vault_root(&app)?;
    let mut images = Vec::new();

    if let Some(ref f) = folder {
        if f == "__all__" {
            collect_media_recursive(&vault, &mut images);
            images.sort_by(|a, b| {
                let meta_a = std::fs::metadata(&a.path).and_then(|m| m.modified()).ok();
                let meta_b = std::fs::metadata(&b.path).and_then(|m| m.modified()).ok();
                meta_b.cmp(&meta_a)
            });
            return Ok(images);
        }
    }

    let target = if let Some(ref f) = folder {
        vault.join(f)
    } else {
        vault.clone()
    };

    if !target.exists() {
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    }

    if let Ok(entries) = std::fs::read_dir(&target) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if is_media_ext(&ext) {
                    let name = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let path_str = path.to_string_lossy().to_string();
                    let media_type = if is_video_ext(&ext) {
                        "video".to_string()
                    } else {
                        "image".to_string()
                    };
                    images.push(VaultImage { name, path: path_str, media_type });
                }
            }
        }
    }

    // Sort newest modified first
    images.sort_by(|a, b| {
        let meta_a = std::fs::metadata(&a.path).and_then(|m| m.modified()).ok();
        let meta_b = std::fs::metadata(&b.path).and_then(|m| m.modified()).ok();
        meta_b.cmp(&meta_a)
    });

    Ok(images)
}

#[tauri::command]
fn get_total_media_count(app: tauri::AppHandle) -> Result<usize, String> {
    let vault = get_vault_root(&app)?;
    let mut images = Vec::new();
    collect_media_recursive(&vault, &mut images);
    Ok(images.len())
}

#[tauri::command]
fn get_vault_folders(app: tauri::AppHandle) -> Result<Vec<VaultFolder>, String> {
    let vault = get_vault_root(&app)?;
    let mut folders = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&vault) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                // Count media files in that folder
                let count = if let Ok(sub) = std::fs::read_dir(&path) {
                    sub.flatten().filter(|e| {
                        let p = e.path();
                        if p.is_file() {
                            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                            is_media_ext(&ext)
                        } else {
                            false
                        }
                    }).count()
                } else {
                    0
                };
                let path_str = path.to_string_lossy().to_string();
                folders.push(VaultFolder { name, path: path_str, count });
            }
        }
    }

    folders.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(folders)
}

#[tauri::command]
fn create_vault_folder(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let vault = get_vault_root(&app)?;
    let folder = vault.join(&name);
    if folder.exists() {
        return Err(format!("Le dossier '{}' existe déjà", name));
    }
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_vault_folder(app: tauri::AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let vault = get_vault_root(&app)?;
    let old_path = vault.join(&old_name);
    let new_path = vault.join(&new_name);
    if !old_path.exists() {
        return Err(format!("Le dossier '{}' n'existe pas", old_name));
    }
    if new_path.exists() {
        return Err(format!("Le dossier '{}' existe déjà", new_name));
    }
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_vault_folder(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let vault = get_vault_root(&app)?;
    let folder = vault.join(&name);
    if folder.exists() {
        std::fs::remove_dir_all(&folder).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn move_media_to_folder(app: tauri::AppHandle, path: String, folder: String) -> Result<String, String> {
    let vault = get_vault_root(&app)?;
    let src = std::path::PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Fichier source introuvable: {}", path));
    }
    let dest_dir = if folder.is_empty() || folder == "__all__" {
        vault.clone()
    } else {
        vault.join(&folder)
    };
    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    let file_name = src.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let dest_file = dest_dir.join(file_name);

    // 1. Strict equality check: same path or same file
    if src == dest_file {
        return Ok(path);
    }

    // 2. Canonical equality check (handles symlinks, UNC prefix, casing)
    if let (Ok(src_canon), Ok(dest_canon)) = (src.canonicalize(), dest_file.canonicalize()) {
        if src_canon == dest_canon {
            return Ok(path);
        }
    }

    // 3. Parent directory check: if source parent is the same directory as dest_dir, DO NOT MOVE OR DUPLICATE!
    if let (Ok(src_parent_canon), Ok(dest_dir_canon)) = (
        src.parent().unwrap_or(&src).canonicalize(),
        dest_dir.canonicalize(),
    ) {
        if src_parent_canon == dest_dir_canon {
            return Ok(path);
        }
    }

    // Generate unique name only if moving to a different folder and name collision exists
    let mut dest = dest_file;
    let mut counter = 1;
    while dest.exists() {
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("");
        dest = dest_dir.join(format!("{} ({}).{}", stem, counter, ext));
        counter += 1;
    }

    // Try atomic rename, fallback to copy + remove
    if let Err(_rename_err) = std::fs::rename(&src, &dest) {
        std::fs::copy(&src, &dest).map_err(|e| format!("Erreur copie déplacement: {}", e))?;
        let _ = std::fs::remove_file(&src);
    }

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn get_root_media_count(app: tauri::AppHandle) -> Result<usize, String> {
    let vault = get_vault_root(&app)?;
    let count = if let Ok(entries) = std::fs::read_dir(&vault) {
        entries.flatten().filter(|e| {
            let p = e.path();
            if p.is_file() {
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                is_media_ext(&ext)
            } else {
                false
            }
        }).count()
    } else {
        0
    };
    Ok(count)
}

#[tauri::command]
fn save_dropped_files(app: tauri::AppHandle, paths: Vec<String>, folder: Option<String>) -> Result<Vec<String>, String> {
    let vault = get_vault_root(&app)?;
    let dest_dir = if let Some(ref f) = folder {
        vault.join(f)
    } else {
        vault.clone()
    };
    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    let vault_canon = vault.canonicalize().unwrap_or_else(|_| vault.clone());
    let mut saved = Vec::new();

    for p in paths {
        let src_path = std::path::PathBuf::from(&p);
        if !src_path.is_file() {
            continue;
        }
        if let Ok(src_canon) = src_path.canonicalize() {
            if src_canon.starts_with(&vault_canon) {
                continue;
            }
        }
        let ext = src_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !is_media_ext(&ext) {
            continue;
        }

        let original_file_name = src_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("image");
        let file_stem = src_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("image");
        let mut dest_path = dest_dir.join(original_file_name);
        let mut counter = 1;
        while dest_path.exists() {
            let new_name = format!("{} ({}).{}", file_stem, counter, ext);
            dest_path = dest_dir.join(new_name);
            counter += 1;
        }
        if std::fs::copy(&src_path, &dest_path).is_ok() {
            if let Some(dest_str) = dest_path.to_str() {
                saved.push(dest_str.to_string());
            }
        }
    }

    Ok(saved)
}

#[tauri::command]
fn save_image_bytes(app: tauri::AppHandle, name: String, bytes: Vec<u8>, folder: Option<String>) -> Result<String, String> {
    let vault = get_vault_root(&app)?;
    let dest_dir = if let Some(ref f) = folder {
        vault.join(f)
    } else {
        vault.clone()
    };
    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    let detected_ext = detect_media_ext(&bytes);

    let p = std::path::Path::new(&name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext = detected_ext.unwrap_or_else(|| {
        p.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("png")
    });

    let mut dest_path = dest_dir.join(format!("{}.{}", stem, ext));
    let mut counter = 1;
    while dest_path.exists() {
        dest_path = dest_dir.join(format!("{} ({}).{}", stem, counter, ext));
        counter += 1;
    }

    std::fs::write(&dest_path, bytes).map_err(|e| e.to_string())?;
    dest_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to convert path".into())
}

#[tauri::command]
fn download_and_save_image(app: tauri::AppHandle, url: String, folder: Option<String>) -> Result<String, String> {
    if url.contains("asset.localhost") || url.contains("stocacageVault") {
        return Err("Cannot re-import image from own vault".into());
    }

    let vault = get_vault_root(&app)?;
    let dest_dir = if let Some(ref f) = folder {
        vault.join(f)
    } else {
        vault.clone()
    };
    if !dest_dir.exists() {
        let _ = std::fs::create_dir_all(&dest_dir);
    }

    let temp_name = format!(
        "temp_{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let temp_file = dest_dir.join(temp_name);
    let temp_str = temp_file.to_string_lossy().to_string();

    let status = std::process::Command::new("curl.exe")
        .args([
            "-s",
            "-L",
            "-A",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-o",
            &temp_str,
            &url,
        ])
        .status()
        .map_err(|e| format!("curl error: {}", e))?;

    if !status.success() || !temp_file.exists() || temp_file.metadata().map(|m| m.len()).unwrap_or(0) == 0 {
        if temp_file.exists() {
            let _ = std::fs::remove_file(&temp_file);
        }
        return Err("Download failed or empty response".into());
    }

    let bytes = std::fs::read(&temp_file).map_err(|e| e.to_string())?;
    let ext = detect_media_ext(&bytes).unwrap_or("bin");

    let clean_url = url.split('?').next().unwrap_or(&url);
    let raw_name = clean_url
        .split('/')
        .last()
        .filter(|s| !s.is_empty())
        .unwrap_or("image");

    let p = std::path::Path::new(raw_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("image");

    let mut dest_path = dest_dir.join(format!("{}.{}", stem, ext));
    let mut counter = 1;
    while dest_path.exists() {
        dest_path = dest_dir.join(format!("{} ({}).{}", stem, counter, ext));
        counter += 1;
    }

    let _ = std::fs::rename(&temp_file, &dest_path);
    dest_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed path".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Stocacage")
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app
                            .get_webview_window("stocacage")
                            .or_else(|| app.get_webview_window("main"))
                        {
                            let is_visible = window.is_visible().unwrap_or(false);

                            if is_visible {
                                let _ = window.hide();
                            } else {
                                if FIRST_OPEN.swap(false, Ordering::Relaxed) {
                                    let _ = window.move_window(Position::BottomRight);
                                    if let Ok(mut pos) = window.outer_position() {
                                        let scale = window.scale_factor().unwrap_or(1.0);
                                        pos.x -= (12.0 * scale) as i32;
                                        pos.y -= (56.0 * scale) as i32;
                                        let _ = window.set_position(pos);
                                    }
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            hide_window,
            get_vault_config,
            set_vault_path,
            select_folder_dialog,
            open_vault_folder,
            delete_vault_image,
            get_vault_images,
            get_vault_folders,
            create_vault_folder,
            rename_vault_folder,
            delete_vault_folder,
            move_media_to_folder,
            get_root_media_count,
            get_total_media_count,
            save_dropped_files,
            save_image_bytes,
            download_and_save_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
