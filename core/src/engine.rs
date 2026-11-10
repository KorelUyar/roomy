//! One entry point for everything the UI can ask for.
//!
//! The desktop app forwards its single `rpc` command here, and
//! `roomy-cli serve` exposes the very same calls over HTTP so the interface
//! can be driven from a normal browser during development and in tests.

use crate::delete::DeleteRequest;
use crate::scan::{Progress, ScanData};
use crate::{apps, browse, cleanup, delete, platform, safety, scan};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

pub struct Engine {
    version: String,
    scan: RwLock<Option<ScanData>>,
    progress: Mutex<Arc<Progress>>,
    scanning: AtomicBool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathArg {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdArg {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LargeFilesArg {
    #[serde(default)]
    min_size: u64,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    500
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteArg {
    items: Vec<DeleteRequest>,
}

fn arg<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("bad arguments: {e}"))
}

fn ok<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

impl Engine {
    pub fn new(version: impl Into<String>) -> Arc<Self> {
        Arc::new(Engine {
            version: version.into(),
            scan: RwLock::new(None),
            progress: Mutex::new(Arc::new(Progress::default())),
            scanning: AtomicBool::new(false),
        })
    }

    fn status(&self) -> Value {
        let progress = self.progress.lock().unwrap().clone();
        let scanning = self.scanning.load(Ordering::Relaxed);
        let done = self.scan.read().unwrap().is_some();
        let current = progress.current.lock().map(|c| c.clone()).unwrap_or_default();
        json!({
            "state": if scanning { "scanning" } else if done { "done" } else { "idle" },
            "files": progress.files.load(Ordering::Relaxed),
            "bytes": progress.bytes.load(Ordering::Relaxed),
            "current": current,
        })
    }

    /// Scans the whole disk in the background. Poll `scan_status` for progress.
    fn start_scan(self: &Arc<Self>) {
        if self.scanning.swap(true, Ordering::SeqCst) {
            return;
        }
        let progress = Arc::new(Progress::default());
        *self.progress.lock().unwrap() = progress.clone();
        let engine = self.clone();
        std::thread::spawn(move || {
            let data = scan::scan(&platform::scan_root(), &progress);
            *engine.scan.write().unwrap() = Some(data);
            engine.scanning.store(false, Ordering::SeqCst);
        });
    }

    /// Blocks until a running scan has finished (used by the CLI and tests).
    pub fn wait_for_scan(&self) {
        while self.scanning.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    pub fn call(self: &Arc<Self>, cmd: &str, args: Value) -> Result<Value, String> {
        match cmd {
            "app_info" => Ok(json!({
                "platform": if cfg!(target_os = "macos") { "macos" } else if cfg!(windows) { "windows" } else { "linux" },
                "version": self.version,
                "home": platform::home().to_string_lossy(),
                "root": platform::scan_root().to_string_lossy(),
                "locale": platform::locale(),
                "fullDiskAccess": platform::has_full_disk_access(),
                "demo": std::env::var("ROOMY_DEMO").map(|v| v == "1").unwrap_or(false),
                "shotsDir": std::env::var("ROOMY_SHOTS").ok().filter(|s| !s.is_empty()),
            })),
            "disk_info" => ok(platform::disk_info()),
            "scan_status" => Ok(self.status()),
            "start_scan" => {
                self.start_scan();
                Ok(Value::Null)
            }
            "get_overview" => {
                let guard = self.scan.read().unwrap();
                ok(guard.as_ref().map(|scan| browse::overview(scan, platform::disk_info())))
            }
            "list_dir" => {
                let a: PathArg = arg(args)?;
                let guard = self.scan.read().unwrap();
                let scan = guard.as_ref().ok_or("not-scanned")?;
                ok(browse::list_dir(scan, Path::new(&a.path))?)
            }
            "large_files" => {
                let a: LargeFilesArg = arg(args)?;
                let guard = self.scan.read().unwrap();
                ok(match guard.as_ref() {
                    Some(scan) => browse::large_files(scan, a.min_size, a.limit),
                    None => Vec::new(),
                })
            }
            "list_apps" => ok(apps::list()),
            "app_related" => {
                let a: PathArg = arg(args)?;
                ok(apps::related(&a.path))
            }
            "uninstall_app" => {
                let a: IdArg = arg(args)?;
                apps::uninstall(&a.id)?;
                Ok(Value::Null)
            }
            "cleanup_suggestions" => ok(cleanup::suggestions()),
            "delete_items" => {
                let a: DeleteArg = arg(args)?;
                let mut out = Vec::with_capacity(a.items.len());
                for req in &a.items {
                    // The lock is taken per item so reads can happen in between.
                    let mut guard = self.scan.write().unwrap();
                    out.push(delete::delete(req, guard.as_mut()));
                }
                ok(out)
            }
            "trash_info" => ok(delete::trash_info().map(|(size, items)| json!({ "size": size, "items": items }))),
            "empty_trash" => ok(delete::empty_trash()?),
            "is_protected" => {
                let a: PathArg = arg(args)?;
                ok(safety::is_protected(Path::new(&a.path)))
            }
            "reveal" => {
                let a: PathArg = arg(args)?;
                platform::reveal(Path::new(&a.path))?;
                Ok(Value::Null)
            }
            "open_path" => {
                let a: PathArg = arg(args)?;
                platform::open(Path::new(&a.path))?;
                Ok(Value::Null)
            }
            "open_full_disk_access" => {
                platform::open_full_disk_access_settings()?;
                Ok(Value::Null)
            }
            other => Err(format!("unknown command: {other}")),
        }
    }
}
