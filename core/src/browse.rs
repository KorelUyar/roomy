//! Read-only views on a finished scan: the overview, folder listings and the
//! list of the largest files.

use crate::platform::{self, kind_of, DiskInfo};
use crate::safety;
use crate::scan::{self, ScanData};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    /// The folder this entry is in.
    pub parent: String,
    pub size: u64,
    /// Number of files inside (folders only).
    pub files: u64,
    pub is_dir: bool,
    /// A bundle shown as a single item (not browsable).
    pub package: bool,
    pub kind: &'static str,
    pub modified: i64,
    pub protected: bool,
    pub denied: bool,
    /// Lives in the user's Library / AppData: data that belongs to an app.
    pub app_data: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    /// "apps" | "documents" | "downloads" | "media" | "developer" | "appData" | "otherHome" | "otherUsers" | "system",
    /// or "folder" for a top-level folder of a disk that is not the system disk (see `name`).
    pub id: &'static str,
    /// The folder's name when `id` is "folder".
    pub name: Option<String>,
    pub size: u64,
    /// Folder to open when the category is clicked.
    pub path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub disk: DiskInfo,
    /// Bytes the scan could account for.
    pub scanned: u64,
    pub files: u64,
    pub duration_ms: u64,
    pub finished: i64,
    pub categories: Vec<Category>,
    /// The biggest folders in the home folder.
    pub top_folders: Vec<Entry>,
    pub big_file_count: u64,
    pub big_file_size: u64,
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn app_data_roots() -> Vec<PathBuf> {
    let home = platform::home();
    if cfg!(windows) {
        vec![home.join("AppData")]
    } else {
        vec![home.join("Library")]
    }
}

fn is_app_data(path: &Path) -> bool {
    app_data_roots().iter().any(|r| path.starts_with(r))
}

/// Folders whose big files are not the user's to delete one by one.
fn system_roots() -> Vec<PathBuf> {
    let root = platform::scan_root();
    if cfg!(windows) {
        ["Windows", "Program Files", "Program Files (x86)", "ProgramData", "Recovery", "$Recycle.Bin"]
            .iter()
            .map(|d| root.join(d))
            .collect()
    } else {
        ["System", "Library", "private", "usr", "bin", "sbin", "opt", "cores", "Applications"]
            .iter()
            .map(|d| root.join(d))
            .collect()
    }
}

/// Lists `path`, biggest first. Folder sizes come from the scan.
pub fn list_dir(scan: &ScanData, path: &Path) -> Result<Vec<Entry>, String> {
    let rd = fs::read_dir(path).map_err(|e| e.to_string())?;
    let node = scan.find(path);
    let parent = s(path);
    let mut out: Vec<Entry> = Vec::new();

    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let p = entry.path();
        if ft.is_dir() {
            // Folders the scan did not enter (other disks, /dev …) are not shown.
            let Some(child) = node.and_then(|n| n.children.iter().find(|c| c.name.as_ref() == name.as_str())) else {
                continue;
            };
            let modified = entry.metadata().map(|md| scan::file_meta(&md).modified).unwrap_or(0);
            out.push(Entry {
                kind: kind_of(&name, true, child.package),
                protected: safety::is_protected(&p),
                app_data: is_app_data(&p),
                path: s(&p),
                parent: parent.clone(),
                name,
                size: child.size,
                files: child.files,
                is_dir: true,
                package: child.package,
                modified,
                denied: child.denied,
            });
        } else {
            let Ok(md) = entry.metadata() else { continue };
            let m = scan::file_meta(&md);
            out.push(Entry {
                kind: kind_of(&name, false, false),
                protected: safety::is_protected(&p),
                app_data: is_app_data(&p),
                path: s(&p),
                parent: parent.clone(),
                name,
                size: m.size,
                files: 1,
                is_dir: false,
                package: false,
                modified: m.modified,
                denied: false,
            });
        }
    }
    out.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

/// The largest files (and bundles) the user could delete, biggest first.
pub fn large_files(scan: &ScanData, min_size: u64, limit: usize) -> Vec<Entry> {
    let system = if scan.root == platform::scan_root() { system_roots() } else { Vec::new() };
    let mut out = Vec::new();
    for f in &scan.big {
        if f.size < min_size {
            break; // sorted by size
        }
        let p = Path::new(&f.path);
        if system.iter().any(|r| p.starts_with(r)) || safety::is_protected(p) {
            continue;
        }
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push(Entry {
            kind: kind_of(&name, f.package, f.package),
            protected: false,
            app_data: is_app_data(p),
            parent: p.parent().map(s).unwrap_or_default(),
            path: f.path.clone(),
            name,
            size: f.size,
            files: 1,
            is_dir: f.package,
            package: f.package,
            modified: f.modified,
            denied: false,
        });
        if out.len() >= limit {
            break;
        }
    }
    out
}

struct Paths {
    apps: Vec<PathBuf>,
    documents: Vec<PathBuf>,
    downloads: Vec<PathBuf>,
    media: Vec<PathBuf>,
    developer: Vec<PathBuf>,
    app_data: PathBuf,
    users: PathBuf,
}

fn paths() -> Paths {
    let home = platform::home();
    let root = platform::scan_root();
    let known = |d: Option<PathBuf>, fallback: &str| d.unwrap_or_else(|| home.join(fallback));
    if cfg!(windows) {
        Paths {
            apps: vec![
                root.join("Program Files"),
                root.join("Program Files (x86)"),
                home.join("AppData\\Local\\Programs"),
            ],
            documents: vec![known(dirs::document_dir(), "Documents"), known(dirs::desktop_dir(), "Desktop")],
            downloads: vec![known(dirs::download_dir(), "Downloads")],
            media: vec![
                known(dirs::picture_dir(), "Pictures"),
                known(dirs::video_dir(), "Videos"),
                known(dirs::audio_dir(), "Music"),
            ],
            developer: [
                ".gradle",
                ".nuget",
                ".cargo",
                ".rustup",
                ".m2",
                ".android",
                ".vscode",
                "AppData\\Local\\npm-cache",
                "AppData\\Local\\Android",
                "AppData\\Local\\pnpm",
                "AppData\\Roaming\\npm",
                "source",
            ]
            .iter()
            .map(|d| home.join(d))
            .collect(),
            app_data: home.join("AppData"),
            users: root.join("Users"),
        }
    } else {
        Paths {
            apps: vec![root.join("Applications"), home.join("Applications")],
            documents: vec![home.join("Documents"), home.join("Desktop")],
            downloads: vec![home.join("Downloads")],
            media: vec![home.join("Pictures"), home.join("Movies"), home.join("Music")],
            developer: [
                "Library/Developer",
                "Library/Android",
                ".cargo",
                ".rustup",
                ".npm",
                ".nvm",
                ".gradle",
                ".m2",
                ".cocoapods",
                ".pub-cache",
                ".android",
                ".docker",
                ".cache",
                ".bun",
                ".pyenv",
                ".rbenv",
                ".vscode",
                "go",
            ]
            .iter()
            .map(|d| home.join(d))
            .collect(),
            app_data: home.join("Library"),
            users: root.join("Users"),
        }
    }
}

/// Overview of a disk that is not the system disk: there are no apps or
/// user folders to tell apart, so the biggest top-level folders stand in.
fn overview_plain(scan: &ScanData, disk: DiskInfo) -> Overview {
    let mut top = list_dir(scan, &scan.root).unwrap_or_default();
    top.retain(|e| e.size > 0 && !e.protected);
    let mut categories: Vec<Category> = top
        .iter()
        .filter(|e| e.is_dir)
        .take(6)
        .map(|e| Category {
            id: "folder",
            name: Some(e.name.clone()),
            size: e.size,
            path: Some(e.path.clone()),
        })
        .collect();
    let shown: u64 = categories.iter().map(|c| c.size).sum();
    categories.push(Category {
        id: "otherHome",
        name: None,
        size: disk.used.saturating_sub(shown),
        path: Some(s(&scan.root)),
    });

    let mut top_folders = top;
    top_folders.retain(|e| e.is_dir);
    top_folders.truncate(8);
    let big = large_files(scan, 100 * 1024 * 1024, usize::MAX);
    Overview {
        disk,
        scanned: scan.tree.size,
        files: scan.tree.files,
        duration_ms: scan.duration_ms,
        finished: scan.finished,
        categories,
        top_folders,
        big_file_count: big.len() as u64,
        big_file_size: big.iter().map(|e| e.size).sum(),
    }
}

pub fn overview(scan: &ScanData, disk: DiskInfo) -> Overview {
    if scan.root != platform::scan_root() {
        return overview_plain(scan, disk);
    }
    let home = platform::home();
    let p = paths();
    let size = |path: &PathBuf| scan.size_of(path);
    let sum = |list: &[PathBuf]| list.iter().map(size).sum::<u64>();

    let apps = sum(&p.apps);
    let documents = sum(&p.documents);
    let downloads = sum(&p.downloads);
    let media = sum(&p.media);
    let developer = sum(&p.developer);
    let home_size = scan.size_of(&home);
    let users = scan.size_of(&p.users).max(home_size);

    // Parts of other categories that live inside the app-data folder.
    let inside = |list: &[PathBuf]| {
        list.iter()
            .filter(|q| q.starts_with(&p.app_data))
            .map(size)
            .sum::<u64>()
    };
    let app_data = scan
        .size_of(&p.app_data)
        .saturating_sub(inside(&p.developer) + inside(&p.apps));

    // Everything in the home folder that has no category of its own.
    let home_apps: u64 = p.apps.iter().filter(|q| q.starts_with(&home)).map(size).sum();
    let other_home = home_size.saturating_sub(documents + downloads + media + developer + app_data + home_apps);
    let other_users = users.saturating_sub(home_size);
    let system_apps: u64 = p.apps.iter().filter(|q| !q.starts_with(&home)).map(size).sum();

    // What is left: the operating system, plus space the scan cannot see
    // (snapshots, swap, other users' private data).
    let accounted = users + system_apps;
    let system = disk.used.saturating_sub(accounted);

    let cat = |id: &'static str, size: u64, path: Option<&PathBuf>| Category {
        id,
        name: None,
        size,
        path: path.map(|q| s(q)),
    };
    let categories = vec![
        cat("apps", apps, p.apps.first()),
        cat("documents", documents, p.documents.first()),
        cat("downloads", downloads, p.downloads.first()),
        cat("media", media, p.media.first()),
        cat("developer", developer, None),
        cat("appData", app_data, Some(&p.app_data)),
        cat("otherHome", other_home, Some(&home)),
        cat("otherUsers", other_users, Some(&p.users)),
        cat("system", system, None),
    ];

    let mut top_folders = list_dir(scan, &home).unwrap_or_default();
    top_folders.retain(|e| e.is_dir && e.size > 0);
    top_folders.truncate(8);

    let big = large_files(scan, 100 * 1024 * 1024, usize::MAX);
    let big_user: Vec<&Entry> = big.iter().filter(|e| !e.app_data).collect();

    Overview {
        disk,
        scanned: scan.tree.size,
        files: scan.tree.files,
        duration_ms: scan.duration_ms,
        finished: scan.finished,
        categories,
        top_folders,
        big_file_count: big_user.len() as u64,
        big_file_size: big_user.iter().map(|e| e.size).sum(),
    }
}
