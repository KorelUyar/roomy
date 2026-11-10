//! Installed applications.
//!
//! * macOS: every `.app` in `/Applications` and `~/Applications`. Removing an
//!   app means moving the bundle to the Trash, plus (optionally) the data it
//!   left in `~/Library`.
//! * Windows: every program registered for "Add or remove programs". Removing
//!   one means starting the program's own uninstaller.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Stable identifier: the bundle path (macOS) or the registry key (Windows).
    pub id: String,
    pub name: String,
    /// Bundle path (macOS) or install folder (Windows, may be empty).
    pub path: String,
    /// File to ask the icon protocol for. Empty when unknown.
    pub icon: String,
    pub bundle_id: Option<String>,
    pub version: Option<String>,
    pub publisher: Option<String>,
    pub size: u64,
    /// Unix seconds of the last launch (macOS only).
    pub last_used: Option<i64>,
    /// Unix seconds of the installation (Windows only).
    pub installed: Option<i64>,
    /// "trash" (delete the bundle) or "uninstaller" (run the vendor's uninstaller).
    pub removal: &'static str,
    pub running: bool,
    /// Came from the App Store / Microsoft Store.
    pub store: bool,
}

/// A file or folder an app left behind outside of its bundle.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RelatedItem {
    pub path: String,
    pub size: u64,
    /// "support" | "cache" | "preferences" | "container" | "logs" | "state" | "other"
    pub kind: &'static str,
}

#[cfg(target_os = "macos")]
pub use mac::{list, related};
#[cfg(windows)]
pub use win::{list, uninstall};

#[cfg(not(any(target_os = "macos", windows)))]
pub fn list() -> Vec<AppInfo> {
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
pub fn related(_app_path: &str) -> Vec<RelatedItem> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn uninstall(_id: &str) -> Result<(), String> {
    Err("Apps are removed by moving them to the Trash on this system.".into())
}

/// Parses `YYYY-MM-DD HH:MM:SS +0000` (what `mdls` prints) to unix seconds.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_utc(s: &str) -> Option<i64> {
    let s = s.trim();
    let (date, rest) = s.split_once(' ')?;
    let time = rest.split(' ').next()?;
    let mut d = date.split('-').map(|x| x.parse::<i64>());
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let mut t = time.split(':').map(|x| x.parse::<i64>());
    let (h, min, sec) = (t.next()?.ok()?, t.next()?.ok()?, t.next()?.ok()?);
    Some(days_from_civil(y, m, day) * 86_400 + h * 3600 + min * 60 + sec)
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use crate::scan;
    use rayon::prelude::*;
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn app_dirs() -> Vec<PathBuf> {
        let mut v = vec![PathBuf::from("/Applications")];
        if let Some(home) = dirs::home_dir() {
            v.push(home.join("Applications"));
        }
        v
    }

    /// `.app` bundles in `dir`, looking one level into plain sub-folders.
    fn find_bundles(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for entry in rd.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            // Symlinks are skipped on purpose: Safari & co. are links into the
            // sealed system volume and cannot be removed.
            if !ft.is_dir() {
                continue;
            }
            let path = entry.path();
            let is_app = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("app"))
                .unwrap_or(false);
            if is_app {
                out.push(path);
            } else if depth < 2 && !scan::is_package_name(&entry.file_name().to_string_lossy()) {
                find_bundles(&path, depth + 1, out);
            }
        }
    }

    fn plist_string(dict: &plist::Dictionary, key: &str) -> Option<String> {
        dict.get(key)
            .and_then(|v| v.as_string())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    fn read_info(bundle: &Path) -> Option<plist::Dictionary> {
        for rel in ["Contents/Info.plist", "WrappedBundle/Info.plist", "Info.plist"] {
            if let Ok(value) = plist::Value::from_file(bundle.join(rel)) {
                if let Some(dict) = value.into_dictionary() {
                    return Some(dict);
                }
            }
        }
        None
    }

    fn last_used(bundle: &Path) -> Option<i64> {
        let out = Command::new("/usr/bin/mdls")
            .args(["-name", "kMDItemLastUsedDate", "-raw"])
            .arg(bundle)
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        if s.contains("(null)") {
            return None;
        }
        parse_utc(&s)
    }

    fn running_bundle_ids() -> HashSet<String> {
        use objc2_app_kit::NSWorkspace;
        let mut set = HashSet::new();
        objc2::rc::autoreleasepool(|_| {
            let ws = NSWorkspace::sharedWorkspace();
            let apps = ws.runningApplications();
            for app in apps.iter() {
                if let Some(id) = app.bundleIdentifier() {
                    set.insert(id.to_string());
                }
            }
        });
        set
    }

    pub fn list() -> Vec<AppInfo> {
        let mut bundles = Vec::new();
        for dir in app_dirs() {
            find_bundles(&dir, 0, &mut bundles);
        }
        let running = running_bundle_ids();

        let mut apps: Vec<AppInfo> = bundles
            .par_iter()
            .map(|bundle| {
                let info = read_info(bundle);
                let bundle_id = info.as_ref().and_then(|d| plist_string(d, "CFBundleIdentifier"));
                let version = info.as_ref().and_then(|d| {
                    plist_string(d, "CFBundleShortVersionString").or_else(|| plist_string(d, "CFBundleVersion"))
                });
                let name = bundle
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let path = bundle.to_string_lossy().into_owned();
                let is_running = bundle_id.as_ref().map(|b| running.contains(b)).unwrap_or(false);
                AppInfo {
                    id: path.clone(),
                    name,
                    icon: path.clone(),
                    path,
                    bundle_id,
                    version,
                    publisher: None,
                    size: scan::measure(bundle).0,
                    last_used: last_used(bundle),
                    installed: None,
                    removal: "trash",
                    running: is_running,
                    store: bundle.join("Contents/_MASReceipt").exists(),
                }
            })
            .collect();
        apps.sort_by(|a, b| b.size.cmp(&a.size));
        apps
    }

    /// What `app_path` left in `~/Library`. Matching is deliberately strict:
    /// exact bundle id, or the exact app name in the three folders where apps
    /// are known to use it.
    pub fn related(app_path: &str) -> Vec<RelatedItem> {
        let bundle = Path::new(app_path);
        let Some(home) = dirs::home_dir() else {
            return Vec::new();
        };
        let lib = home.join("Library");
        let info = read_info(bundle);
        let bundle_id = info
            .as_ref()
            .and_then(|d| plist_string(d, "CFBundleIdentifier"))
            .filter(|id| id.len() >= 6 && id.contains('.'));
        // Apple's own apps share their data with the system: leave it alone.
        if bundle_id.as_deref().map(|b| b.starts_with("com.apple.")).unwrap_or(false) {
            return Vec::new();
        }
        let name = bundle
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|n| n.chars().count() >= 3);

        let mut found: Vec<(PathBuf, &'static str)> = Vec::new();
        let mut add = |p: PathBuf, kind: &'static str| {
            if p.symlink_metadata().is_ok() && !found.iter().any(|(q, _)| *q == p) {
                found.push((p, kind));
            }
        };

        if let Some(id) = &bundle_id {
            add(lib.join("Application Support").join(id), "support");
            add(lib.join("Caches").join(id), "cache");
            add(lib.join("Preferences").join(format!("{id}.plist")), "preferences");
            add(lib.join("Saved Application State").join(format!("{id}.savedState")), "state");
            add(lib.join("Containers").join(id), "container");
            add(lib.join("Application Scripts").join(id), "container");
            add(lib.join("Logs").join(id), "logs");
            add(lib.join("HTTPStorages").join(id), "cache");
            add(lib.join("HTTPStorages").join(format!("{id}.binarycookies")), "cache");
            add(lib.join("WebKit").join(id), "cache");
            add(lib.join("Cookies").join(format!("{id}.binarycookies")), "cache");

            // Entries that carry the id as a prefix / suffix.
            let scans: [(&str, &'static str); 4] = [
                ("Group Containers", "container"),
                ("LaunchAgents", "other"),
                ("Preferences/ByHost", "preferences"),
                ("Caches", "cache"),
            ];
            for (dir, kind) in scans {
                let Ok(rd) = fs::read_dir(lib.join(dir)) else { continue };
                for entry in rd.flatten() {
                    let n = entry.file_name().to_string_lossy().into_owned();
                    let hit = match dir {
                        // e.g. `group.com.foo.bar` or `TEAMID.com.foo.bar`
                        "Group Containers" => n.ends_with(&format!(".{id}")) || n == *id,
                        _ => n.starts_with(&format!("{id}.")),
                    };
                    if hit {
                        add(entry.path(), kind);
                    }
                }
            }
        }
        if let Some(name) = &name {
            add(lib.join("Application Support").join(name), "support");
            add(lib.join("Caches").join(name), "cache");
            add(lib.join("Logs").join(name), "logs");
        }

        let mut items: Vec<RelatedItem> = found
            .par_iter()
            .map(|(p, kind)| RelatedItem {
                path: p.to_string_lossy().into_owned(),
                size: scan::measure(p).0,
                kind,
            })
            .collect();
        items.sort_by(|a, b| b.size.cmp(&a.size));
        items
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::scan;
    use rayon::prelude::*;
    use std::collections::HashSet;
    use std::path::Path;
    use winreg::enums::*;
    use winreg::RegKey;

    const UNINSTALL: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

    struct Hive {
        tag: &'static str,
        root: winreg::HKEY,
        flags: u32,
    }

    fn hives() -> [Hive; 3] {
        [
            Hive {
                tag: "HKLM64",
                root: HKEY_LOCAL_MACHINE,
                flags: KEY_READ | KEY_WOW64_64KEY,
            },
            Hive {
                tag: "HKLM32",
                root: HKEY_LOCAL_MACHINE,
                flags: KEY_READ | KEY_WOW64_32KEY,
            },
            Hive {
                tag: "HKCU",
                root: HKEY_CURRENT_USER,
                flags: KEY_READ,
            },
        ]
    }

    fn string(key: &RegKey, name: &str) -> Option<String> {
        key.get_value::<String, _>(name)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    fn dword(key: &RegKey, name: &str) -> Option<u32> {
        key.get_value::<u32, _>(name).ok()
    }

    /// `"C:\x\app.exe",0` → `C:\x\app.exe`
    fn clean_icon_path(raw: &str) -> String {
        let mut s = raw.trim().to_string();
        if let Some(idx) = s.rfind(',') {
            if s[idx + 1..].trim().parse::<i32>().is_ok() {
                s.truncate(idx);
            }
        }
        s.trim().trim_matches('"').to_string()
    }

    fn parse_install_date(s: &str) -> Option<i64> {
        if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let y: i64 = s[0..4].parse().ok()?;
        let m: i64 = s[4..6].parse().ok()?;
        let d: i64 = s[6..8].parse().ok()?;
        if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
            return None;
        }
        Some(days_from_civil(y, m, d) * 86_400)
    }

    /// The command that removes the program registered under `sub`.
    fn uninstall_command(key: &RegKey, sub: &str) -> Option<String> {
        if dword(key, "WindowsInstaller") == Some(1) && sub.starts_with('{') {
            return Some(format!("msiexec.exe /x {sub}"));
        }
        string(key, "UninstallString")
    }

    pub fn list() -> Vec<AppInfo> {
        let mut apps: Vec<AppInfo> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        for hive in hives() {
            let Ok(root) = RegKey::predef(hive.root).open_subkey_with_flags(UNINSTALL, hive.flags) else {
                continue;
            };
            for sub in root.enum_keys().flatten() {
                let Ok(key) = root.open_subkey_with_flags(&sub, hive.flags) else {
                    continue;
                };
                let Some(name) = string(&key, "DisplayName") else { continue };
                if dword(&key, "SystemComponent") == Some(1) {
                    continue;
                }
                if string(&key, "ParentKeyName").is_some() || string(&key, "ReleaseType").is_some() {
                    continue;
                }
                if uninstall_command(&key, &sub).is_none() {
                    continue;
                }
                let version = string(&key, "DisplayVersion");
                let dedupe = format!("{}|{}", name.to_lowercase(), version.clone().unwrap_or_default());
                if !seen.insert(dedupe) {
                    continue;
                }
                let location = string(&key, "InstallLocation")
                    .map(|s| s.trim_matches('"').trim_end_matches('\\').to_string())
                    .filter(|s| s.len() > 3 && Path::new(s).is_dir())
                    .unwrap_or_default();
                let mut icon = string(&key, "DisplayIcon").map(|s| clean_icon_path(&s)).unwrap_or_default();
                if !icon.is_empty() && !Path::new(&icon).exists() {
                    icon.clear();
                }
                apps.push(AppInfo {
                    id: format!("{}\\{}", hive.tag, sub),
                    name,
                    path: location,
                    icon,
                    bundle_id: None,
                    version,
                    publisher: string(&key, "Publisher"),
                    size: dword(&key, "EstimatedSize").map(|kb| kb as u64 * 1024).unwrap_or(0),
                    last_used: None,
                    installed: string(&key, "InstallDate").and_then(|s| parse_install_date(&s)),
                    removal: "uninstaller",
                    running: false,
                    store: false,
                });
            }
        }

        // Installers write their size to the registry, but not all of them do
        // (games installed through a launcher, for example). Only those are
        // measured: walking every program folder would take too long.
        apps.par_iter_mut().for_each(|app| {
            if app.size == 0 && !app.path.is_empty() && !crate::safety::is_hard_protected(Path::new(&app.path)) {
                app.size = scan::measure(Path::new(&app.path)).0;
            }
            if app.icon.is_empty() && !app.path.is_empty() {
                // Fall back to the first .exe in the install folder.
                if let Ok(rd) = std::fs::read_dir(&app.path) {
                    for e in rd.flatten() {
                        let p = e.path();
                        if p.extension().map(|x| x.eq_ignore_ascii_case("exe")).unwrap_or(false) {
                            app.icon = p.to_string_lossy().into_owned();
                            break;
                        }
                    }
                }
            }
        });

        apps.sort_by(|a, b| b.size.cmp(&a.size));
        apps
    }

    /// Start the program's own uninstaller. Returns as soon as it is running.
    pub fn uninstall(id: &str) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let (tag, sub) = id.split_once('\\').ok_or("Unknown app")?;
        let hive = hives().into_iter().find(|h| h.tag == tag).ok_or("Unknown app")?;
        let key = RegKey::predef(hive.root)
            .open_subkey_with_flags(format!("{UNINSTALL}\\{sub}"), hive.flags)
            .map_err(|e| e.to_string())?;
        let cmd = uninstall_command(&key, sub).ok_or("This app has no uninstaller.")?;

        // `cmd /C ""C:\Program Files\X\uninstall.exe" /arg"`: the outer pair
        // of quotes is what cmd strips, the rest reaches the program intact.
        std::process::Command::new("cmd.exe")
            .raw_arg(format!("/C \"{cmd}\""))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mdls_dates() {
        assert_eq!(parse_utc("1970-01-01 00:00:00 +0000"), Some(0));
        assert_eq!(parse_utc("2026-11-10 17:21:09 +0000"), Some(1_794_331_269));
        assert_eq!(parse_utc("(null)"), None);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
    }
}
