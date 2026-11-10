//! One entry point for everything the UI can ask for.
//!
//! The desktop app forwards its single `rpc` command here, and
//! `roomy-cli serve` exposes the very same calls over HTTP so the interface
//! can be driven from a normal browser during development and in tests.

use crate::delete::DeleteRequest;
use crate::scan::{Progress, ScanData};
use crate::{apps, bloat, browse, cleanup, delete, platform, safety, scan};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};

pub struct Engine {
    version: String,
    /// One finished scan per disk, keyed by the disk's mount point.
    scans: RwLock<HashMap<PathBuf, ScanData>>,
    progress: Mutex<HashMap<PathBuf, Arc<Progress>>>,
    scanning: Mutex<HashSet<PathBuf>>,
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

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RootArg {
    /// Mount point of the disk. Missing = the system disk.
    #[serde(default)]
    root: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LargeFilesArg {
    #[serde(default)]
    root: Option<String>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PidsArg {
    pids: Vec<u32>,
}

fn arg<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("bad arguments: {e}"))
}

/// Like `arg`, but a missing argument object is fine.
fn arg_or_default<T: for<'de> Deserialize<'de> + Default>(args: Value) -> Result<T, String> {
    if args.is_null() {
        Ok(T::default())
    } else {
        arg(args)
    }
}

fn ok<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn root_of(root: Option<String>) -> PathBuf {
    root.map(PathBuf::from).unwrap_or_else(platform::scan_root)
}

impl Engine {
    pub fn new(version: impl Into<String>) -> Arc<Self> {
        Arc::new(Engine {
            version: version.into(),
            scans: RwLock::new(HashMap::new()),
            progress: Mutex::new(HashMap::new()),
            scanning: Mutex::new(HashSet::new()),
        })
    }

    fn status(&self, root: &Path) -> Value {
        let progress = self.progress.lock().unwrap().get(root).cloned();
        let scanning = self.scanning.lock().unwrap().contains(root);
        let done = self.scans.read().unwrap().contains_key(root);
        let (files, bytes, current) = match &progress {
            Some(p) => (
                p.files.load(Ordering::Relaxed),
                p.bytes.load(Ordering::Relaxed),
                p.current.lock().map(|c| c.clone()).unwrap_or_default(),
            ),
            None => (0, 0, String::new()),
        };
        json!({
            "state": if scanning { "scanning" } else if done { "done" } else { "idle" },
            "files": files,
            "bytes": bytes,
            "current": current,
        })
    }

    /// Scans one disk in the background. Poll `scan_status` for progress.
    fn start_scan(self: &Arc<Self>, root: PathBuf) -> Result<(), String> {
        // Only whole disks are scanned: never a path someone made up.
        if !platform::is_disk_root(&root) {
            return Err("not a disk".into());
        }
        if !self.scanning.lock().unwrap().insert(root.clone()) {
            return Ok(());
        }
        let progress = Arc::new(Progress::default());
        self.progress.lock().unwrap().insert(root.clone(), progress.clone());
        let engine = self.clone();
        std::thread::spawn(move || {
            let data = scan::scan(&root, &progress);
            engine.scans.write().unwrap().insert(root.clone(), data);
            engine.scanning.lock().unwrap().remove(&root);
        });
        Ok(())
    }

    /// Blocks until no scan is running (used by the CLI and tests).
    pub fn wait_for_scan(&self) {
        while !self.scanning.lock().unwrap().is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    /// The mount point of the scanned disk that `path` is on: the longest
    /// one that is a prefix (`/Volumes/Backup/x` belongs to `/Volumes/Backup`,
    /// not to `/`).
    fn root_for(scans: &HashMap<PathBuf, ScanData>, path: &Path) -> Option<PathBuf> {
        scans
            .keys()
            .filter(|root| path.starts_with(root))
            .max_by_key(|root| root.as_os_str().len())
            .cloned()
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
            "list_disks" => ok(platform::list_disks()),
            "scan_status" => {
                let a: RootArg = arg_or_default(args)?;
                Ok(self.status(&root_of(a.root)))
            }
            "start_scan" => {
                let a: RootArg = arg_or_default(args)?;
                self.start_scan(root_of(a.root))?;
                Ok(Value::Null)
            }
            "get_overview" => {
                let a: RootArg = arg_or_default(args)?;
                let root = root_of(a.root);
                let guard = self.scans.read().unwrap();
                ok(guard.get(&root).and_then(|scan| {
                    platform::disk_info_for(&root).map(|disk| browse::overview(scan, disk))
                }))
            }
            "list_dir" => {
                let a: PathArg = arg(args)?;
                let path = PathBuf::from(&a.path);
                let guard = self.scans.read().unwrap();
                let root = Self::root_for(&guard, &path).ok_or("not-scanned")?;
                ok(browse::list_dir(&guard[&root], &path)?)
            }
            "large_files" => {
                let a: LargeFilesArg = arg(args)?;
                let guard = self.scans.read().unwrap();
                ok(match guard.get(&root_of(a.root)) {
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
                    let mut guard = self.scans.write().unwrap();
                    let root = Self::root_for(&guard, Path::new(&req.path));
                    let scan = root.and_then(|r| guard.get_mut(&r));
                    out.push(delete::delete(req, scan));
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
            // --- Bloat Scanner ---------------------------------------------
            "bloat_scan" => ok(bloat::scan()),
            "bloat_disable_startup" => {
                let a: IdArg = arg(args)?;
                bloat::disable_startup(&a.id)?;
                Ok(Value::Null)
            }
            "bloat_quit" => {
                let a: PidsArg = arg(args)?;
                ok(bloat::quit(&a.pids))
            }
            "bloat_remove_package" => {
                let a: IdArg = arg(args)?;
                bloat::remove_package(&a.id)?;
                Ok(Value::Null)
            }
            "open_settings" => {
                let a: IdArg = arg(args)?;
                bloat::open_settings(&a.id)?;
                Ok(Value::Null)
            }
            other => Err(format!("unknown command: {other}")),
        }
    }
}
