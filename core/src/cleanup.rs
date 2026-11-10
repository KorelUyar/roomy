//! Things that are (almost) always safe to throw away: the Trash, caches,
//! logs, build leftovers, installers that were already used.

use crate::platform::kind_of;
use crate::scan;
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Smaller items are not worth a row.
const MIN_ITEM: u64 = 512 * 1024;
/// Downloads untouched for this long are suggested for review.
const OLD_DOWNLOAD_DAYS: i64 = 90;

/// Pseudo path that stands for "everything in the Trash / Recycle Bin".
pub const TRASH_TOKEN: &str = "::trash";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: i64,
    pub kind: &'static str,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanGroup {
    /// "trash" | "caches" | "logs" | "temp" | "developer" | "installers" | "oldDownloads" | "backups"
    pub id: &'static str,
    /// "safe": nothing of value is lost. "review": look before you delete.
    pub safety: &'static str,
    /// How items of this group are removed: "permanent" | "trash" | "emptyTrash".
    pub mode: &'static str,
    pub items: Vec<CleanItem>,
    pub size: u64,
    /// The size could not be determined (e.g. the Trash without Full Disk Access).
    pub unknown: bool,
}

fn item_for(path: &Path, name: Option<String>) -> Option<CleanItem> {
    let md = fs::symlink_metadata(path).ok()?;
    let is_dir = md.is_dir();
    let (size, _) = scan::measure(path);
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Some(CleanItem {
        path: path.to_string_lossy().into_owned(),
        kind: kind_of(&file_name, is_dir, is_dir && scan::is_package_name(&file_name)),
        name: name.unwrap_or(file_name),
        size,
        modified: scan::file_meta(&md).modified,
    })
}

/// One item per child of `dir`.
fn children(dir: &Path, skip: &dyn Fn(&str) -> bool) -> Vec<CleanItem> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let paths: Vec<PathBuf> = rd
        .flatten()
        .filter(|e| !skip(&e.file_name().to_string_lossy()))
        .map(|e| e.path())
        .collect();
    paths.par_iter().filter_map(|p| item_for(p, None)).collect()
}

fn group(id: &'static str, safety: &'static str, mode: &'static str, mut items: Vec<CleanItem>) -> Option<CleanGroup> {
    items.retain(|i| i.size >= MIN_ITEM);
    if items.is_empty() {
        return None;
    }
    items.sort_by(|a, b| b.size.cmp(&a.size));
    let size = items.iter().map(|i| i.size).sum();
    Some(CleanGroup {
        id,
        safety,
        mode,
        items,
        size,
        unknown: false,
    })
}

fn created_or_modified(md: &fs::Metadata) -> i64 {
    let to_unix = |t: std::time::SystemTime| {
        t.duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    };
    let created = md.created().map(to_unix).unwrap_or(0);
    let modified = md.modified().map(to_unix).unwrap_or(0);
    created.max(modified)
}

const INSTALLER_EXT: &[&str] = &["dmg", "pkg", "mpkg", "xip", "iso", "exe", "msi", "msix", "msixbundle", "appx"];

fn is_installer(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if cfg!(windows) {
        matches!(ext.as_str(), "exe" | "msi" | "msix" | "msixbundle" | "appx" | "iso")
    } else {
        INSTALLER_EXT[..5].contains(&ext.as_str())
    }
}

/// Installers and old files in the Downloads folder (and installers on the Desktop).
fn downloads_groups(out: &mut Vec<CleanGroup>) {
    let mut installers: Vec<PathBuf> = Vec::new();
    let mut old: Vec<PathBuf> = Vec::new();
    let cutoff = scan::now_unix() - OLD_DOWNLOAD_DAYS * 86_400;

    if let Some(dl) = dirs::download_dir() {
        if let Ok(rd) = fs::read_dir(&dl) {
            for entry in rd.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") {
                    continue;
                }
                let path = entry.path();
                let Ok(md) = entry.metadata() else { continue };
                if md.is_file() && is_installer(&path) {
                    installers.push(path);
                } else if created_or_modified(&md) < cutoff {
                    old.push(path);
                }
            }
        }
    }
    if let Some(desktop) = dirs::desktop_dir() {
        if let Ok(rd) = fs::read_dir(&desktop) {
            for entry in rd.flatten() {
                let path = entry.path();
                let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
                // Program shortcuts on a Windows desktop are not installers.
                if is_file && is_installer(&path) && !cfg!(windows) {
                    installers.push(path);
                }
            }
        }
    }

    let items = installers.par_iter().filter_map(|p| item_for(p, None)).collect();
    out.extend(group("installers", "safe", "trash", items));
    let items = old.par_iter().filter_map(|p| item_for(p, None)).collect();
    out.extend(group("oldDownloads", "review", "trash", items));
}

/// Named locations (label, path). Each becomes one row.
fn named(list: Vec<(&str, PathBuf)>) -> Vec<CleanItem> {
    list.into_par_iter()
        .filter_map(|(label, path)| item_for(&path, Some(label.to_string())))
        .collect()
}

#[cfg(target_os = "macos")]
pub fn suggestions() -> Vec<CleanGroup> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let lib = home.join("Library");
    let mut out: Vec<CleanGroup> = Vec::new();

    // Trash. Without Full Disk Access macOS does not let us look inside, but
    // Finder can still empty it for us.
    let trash = home.join(".Trash");
    match fs::read_dir(&trash) {
        Ok(_) => {
            let items = children(&trash, &|n| n == ".DS_Store");
            let mut items = items;
            items.sort_by(|a, b| b.size.cmp(&a.size));
            let size: u64 = items.iter().map(|i| i.size).sum();
            if !items.is_empty() {
                out.push(CleanGroup {
                    id: "trash",
                    safety: "safe",
                    mode: "permanent",
                    items,
                    size,
                    unknown: false,
                });
            }
        }
        Err(_) => out.push(CleanGroup {
            id: "trash",
            safety: "safe",
            mode: "emptyTrash",
            items: vec![CleanItem {
                path: TRASH_TOKEN.into(),
                name: "Trash".into(),
                size: 0,
                modified: 0,
                kind: "folder",
            }],
            size: 0,
            unknown: true,
        }),
    }

    // App caches. Apple's own are left alone: the system manages them.
    const SYSTEM_CACHES: &[&str] = &[
        "CloudKit",
        "FamilyCircle",
        "familycircled",
        "GeoServices",
        "PassKit",
        "GameKit",
        "Metadata",
        "askpermissiond",
        "storeassetd",
        "storedownloadd",
        "TemporaryItems",
        "com.koreluyar.roomy",
    ];
    let caches = children(&lib.join("Caches"), &|n| {
        n.starts_with("com.apple.") || n.starts_with('.') || SYSTEM_CACHES.contains(&n)
    });
    out.extend(group("caches", "safe", "permanent", caches));

    let mut logs = children(&lib.join("Logs"), &|n| n.starts_with('.'));
    logs.extend(children(&lib.join("Application Support/CrashReporter"), &|n| n.starts_with('.')));
    out.extend(group("logs", "safe", "permanent", logs));

    // Build leftovers and package-manager caches. Everything here is
    // downloaded or generated again when it is needed.
    let mut dev: Vec<CleanItem> = Vec::new();
    for item in children(&lib.join("Developer/Xcode/DerivedData"), &|n| n.starts_with('.')) {
        let project = item.name.split('-').next().unwrap_or(&item.name).to_string();
        dev.push(CleanItem {
            name: format!("Xcode build data · {project}"),
            ..item
        });
    }
    for item in children(&lib.join("Developer/Xcode/iOS DeviceSupport"), &|n| n.starts_with('.')) {
        dev.push(CleanItem {
            name: format!("iOS device support · {}", item.name),
            ..item
        });
    }
    dev.extend(named(vec![
        ("Simulator caches", lib.join("Developer/CoreSimulator/Caches")),
        ("npm cache", home.join(".npm/_cacache")),
        ("Yarn cache", lib.join("Caches/Yarn")),
        ("pnpm store", lib.join("pnpm/store")),
        ("Bun cache", home.join(".bun/install/cache")),
        ("Gradle caches", home.join(".gradle/caches")),
        ("Maven repository", home.join(".m2/repository")),
        ("Cargo registry", home.join(".cargo/registry")),
        ("CocoaPods cache", lib.join("Caches/CocoaPods")),
        ("Flutter pub cache", home.join(".pub-cache")),
        ("Go build cache", lib.join("Caches/go-build")),
    ]));
    for item in children(&home.join(".cache"), &|n| n.starts_with('.')) {
        dev.push(CleanItem {
            name: format!("~/.cache/{}", item.name),
            ..item
        });
    }
    // Some of the named ones live in ~/Library/Caches and are listed there already.
    let cache_paths: Vec<String> = out
        .iter()
        .filter(|g| g.id == "caches")
        .flat_map(|g| g.items.iter().map(|i| i.path.clone()))
        .collect();
    dev.retain(|i| !cache_paths.contains(&i.path));
    out.extend(group("developer", "safe", "permanent", dev));

    downloads_groups(&mut out);

    let backups = children(&lib.join("Application Support/MobileSync/Backup"), &|n| n.starts_with('.'));
    out.extend(group("backups", "review", "trash", backups));

    out
}

#[cfg(windows)]
pub fn suggestions() -> Vec<CleanGroup> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let local = dirs::data_local_dir().unwrap_or_else(|| home.join("AppData\\Local"));
    let roaming = dirs::config_dir().unwrap_or_else(|| home.join("AppData\\Roaming"));
    let mut out: Vec<CleanGroup> = Vec::new();

    let (bin_size, bin_items) = crate::delete::recycle_bin_info();
    if bin_items > 0 {
        out.push(CleanGroup {
            id: "trash",
            safety: "safe",
            mode: "emptyTrash",
            items: vec![CleanItem {
                path: TRASH_TOKEN.into(),
                name: "Recycle Bin".into(),
                size: bin_size,
                modified: 0,
                kind: "folder",
            }],
            size: bin_size,
            unknown: false,
        });
    }

    let temp = std::env::temp_dir();
    out.extend(group("temp", "safe", "permanent", children(&temp, &|_| false)));

    let chromium = |label: &'static str, base: PathBuf| -> Vec<(&'static str, PathBuf)> {
        vec![
            (label, base.join("Default\\Cache")),
            (label, base.join("Default\\Code Cache")),
            (label, base.join("Default\\GPUCache")),
            (label, base.join("Default\\Service Worker\\CacheStorage")),
        ]
    };
    let mut cache_list: Vec<(&str, PathBuf)> = Vec::new();
    cache_list.extend(chromium("Google Chrome cache", local.join("Google\\Chrome\\User Data")));
    cache_list.extend(chromium("Brave cache", local.join("BraveSoftware\\Brave-Browser\\User Data")));
    cache_list.extend(vec![
        ("Discord cache", roaming.join("discord\\Cache")),
        ("Discord code cache", roaming.join("discord\\Code Cache")),
        ("Slack cache", roaming.join("Slack\\Cache")),
        ("Spotify cache", local.join("Spotify\\Storage")),
        ("VS Code cache", roaming.join("Code\\Cache")),
        ("VS Code cached data", roaming.join("Code\\CachedData")),
        ("Graphics shader cache", local.join("D3DSCache")),
        ("NVIDIA shader cache", local.join("NVIDIA\\DXCache")),
        ("Crash dumps", local.join("CrashDumps")),
        ("Steam web cache", local.join("Steam\\htmlcache")),
    ]);
    let mut caches = named(cache_list);
    if let Ok(rd) = fs::read_dir(local.join("Mozilla\\Firefox\\Profiles")) {
        for e in rd.flatten() {
            caches.extend(item_for(&e.path().join("cache2"), Some("Firefox cache".into())));
        }
    }
    out.extend(group("caches", "safe", "permanent", caches));

    let dev = named(vec![
        ("npm cache", local.join("npm-cache")),
        ("Yarn cache", local.join("Yarn\\Cache")),
        ("pnpm store", local.join("pnpm\\store")),
        ("pip cache", local.join("pip\\Cache")),
        ("Gradle caches", home.join(".gradle\\caches")),
        ("Maven repository", home.join(".m2\\repository")),
        ("NuGet packages", home.join(".nuget\\packages")),
        ("Cargo registry", home.join(".cargo\\registry")),
        ("Flutter pub cache", local.join("Pub\\Cache")),
    ]);
    out.extend(group("developer", "safe", "permanent", dev));

    downloads_groups(&mut out);
    out
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn suggestions() -> Vec<CleanGroup> {
    let mut out = Vec::new();
    downloads_groups(&mut out);
    let _ = (named(Vec::new()), children(Path::new("/nonexistent"), &|_| false));
    out
}
