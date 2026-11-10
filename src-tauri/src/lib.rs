//! The Roomy desktop app: a window, and a handful of commands that expose
//! `roomy-core` to the UI.

use roomy_core::engine::Engine;
use roomy_core::icons;
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Every request of the UI goes through here. See `roomy_core::engine`.
#[tauri::command(async)]
fn rpc(engine: State<'_, Arc<Engine>>, cmd: String, args: Option<Value>) -> Result<Value, String> {
    if std::env::var_os("ROOMY_TRACE").is_some() {
        eprintln!("[rpc] {cmd}");
    }
    engine.call(&cmd, args.unwrap_or(Value::Null))
}

// ---------------------------------------------------------------------------
// Development helpers. They only work when ROOMY_SHOTS points to a folder.
// ---------------------------------------------------------------------------

fn shots_dir() -> Option<std::path::PathBuf> {
    std::env::var("ROOMY_SHOTS")
        .ok()
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
}

fn safe_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

/// Saves a picture of the window's content as `<ROOMY_SHOTS>/<name>.png`.
#[tauri::command(async)]
fn debug_snapshot(window: tauri::WebviewWindow, name: String) -> Result<(), String> {
    if std::env::var_os("ROOMY_TRACE").is_some() {
        eprintln!("[snapshot] {name}");
    }
    let dir = shots_dir().ok_or("ROOMY_SHOTS is not set")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    snapshot::take(&window, dir.join(format!("{}.png", safe_name(&name))))
}

/// Writes a text file into the screenshots folder (recorded demo data).
#[tauri::command(async)]
fn debug_write(name: String, contents: String) -> Result<(), String> {
    let dir = shots_dir().ok_or("ROOMY_SHOTS is not set")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(safe_name(&name)), contents).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn debug_exit(app: AppHandle) {
    if shots_dir().is_some() {
        app.exit(0);
    }
}

#[cfg(target_os = "macos")]
mod snapshot {
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::Duration;

    pub fn take(window: &tauri::WebviewWindow, file: PathBuf) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        window
            .with_webview(move |webview| unsafe {
                let wk: &WKWebView = &*(webview.inner() as *const WKWebView);
                let done = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                    let result = (|| -> Result<(), String> {
                        let image = image.as_ref().ok_or("no image")?;
                        let tiff = image.TIFFRepresentation().ok_or("no tiff")?;
                        let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("no bitmap")?;
                        let png = rep
                            .representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
                            .ok_or("no png")?;
                        std::fs::write(&file, png.to_vec()).map_err(|e| e.to_string())
                    })();
                    let _ = tx.send(result);
                });
                wk.takeSnapshotWithConfiguration_completionHandler(None, &done);
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "snapshot timed out".to_string())?
    }
}

#[cfg(not(target_os = "macos"))]
mod snapshot {
    pub fn take(_window: &tauri::WebviewWindow, _file: std::path::PathBuf) -> Result<(), String> {
        Err("snapshots are only implemented on macOS".into())
    }
}

/// `roomyicon://localhost/?p=<path>&s=<pixels>` → the system icon as PNG.
fn icon_response(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let mut path: Option<String> = None;
    let mut size = 64u32;
    for pair in request.uri().query().unwrap_or("").split('&') {
        let Some((k, v)) = pair.split_once('=') else { continue };
        let v = percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned();
        match k {
            "p" => path = Some(v),
            "s" => size = v.parse().unwrap_or(64),
            _ => {}
        }
    }
    let png = path.and_then(|p| icons::icon_png(Path::new(&p), size));
    match png {
        Some(bytes) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", "image/png")
            .header("Cache-Control", "max-age=3600")
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes.as_ref().clone())
            .unwrap(),
        None => tauri::http::Response::builder()
            .status(404)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Engine::new(env!("CARGO_PKG_VERSION")))
        .register_asynchronous_uri_scheme_protocol("roomyicon", |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(icon_response(&request)));
        })
        .invoke_handler(tauri::generate_handler![rpc, debug_snapshot, debug_write, debug_exit])
        .run(tauri::generate_context!())
        .expect("error while running Roomy");
}
