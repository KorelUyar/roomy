//! Removing things: to the Trash (default, recoverable) or for good.

use crate::cleanup::TRASH_TOKEN;
use crate::safety;
use crate::scan::{self, ScanData};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    pub path: String,
    /// "trash" | "permanent" | "emptyTrash"
    pub mode: String,
    /// The item comes from the Cleanup tab (cache, log, …): it may live
    /// inside a folder that is otherwise off-limits, e.g. `~/Library/Caches`.
    #[serde(default)]
    pub cleanup: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
    /// Bytes that are gone from where they were.
    pub freed: u64,
    /// The item is in the Trash now; the space is free once that is emptied.
    pub trashed: bool,
    /// Files that could not be removed (in use, no permission).
    pub skipped: u64,
}

fn fail(path: &str, error: impl Into<String>) -> DeleteOutcome {
    DeleteOutcome {
        path: path.to_string(),
        ok: false,
        error: Some(error.into()),
        ..Default::default()
    }
}

/// Deletes one item and keeps the scan result in sync.
pub fn delete(req: &DeleteRequest, scan: Option<&mut ScanData>) -> DeleteOutcome {
    if req.path == TRASH_TOKEN || req.mode == "emptyTrash" {
        return match empty_trash() {
            Ok(freed) => DeleteOutcome {
                path: req.path.clone(),
                ok: true,
                freed,
                ..Default::default()
            },
            Err(e) => fail(&req.path, e),
        };
    }

    let path = Path::new(&req.path);
    let blocked = if req.cleanup {
        safety::is_hard_protected(path)
    } else {
        safety::is_protected(path)
    };
    if blocked {
        return fail(&req.path, "protected");
    }
    let Ok(md) = fs::symlink_metadata(path) else {
        // Already gone: nothing to do, and nothing to complain about.
        if let Some(scan) = scan {
            scan.forget(path, 0);
        }
        return DeleteOutcome {
            path: req.path.clone(),
            ok: true,
            ..Default::default()
        };
    };
    let is_dir = md.is_dir();
    let known = scan.as_ref().and_then(|s| s.find(path)).map(|n| (n.size, n.files));
    let (size, files) = match known {
        Some(k) if is_dir => k,
        _ => scan::measure(path),
    };

    if req.mode == "permanent" {
        let (freed, skipped) = remove_best_effort(path);
        if let Some(scan) = scan {
            if skipped == 0 {
                scan.forget(path, if is_dir { 0 } else { size });
            } else {
                scan.shrink(path, freed, files.saturating_sub(skipped));
            }
        }
        let ok = skipped == 0 || freed > 0;
        DeleteOutcome {
            path: req.path.clone(),
            ok,
            error: if ok { None } else { Some("in-use".into()) },
            freed,
            trashed: false,
            skipped,
        }
    } else {
        match move_to_trash(path) {
            Ok(()) => {
                if let Some(scan) = scan {
                    scan.forget(path, if is_dir { 0 } else { size });
                }
                DeleteOutcome {
                    path: req.path.clone(),
                    ok: true,
                    freed: size,
                    trashed: true,
                    ..Default::default()
                }
            }
            Err(e) => fail(&req.path, e),
        }
    }
}

fn move_to_trash(path: &Path) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        // Fast and silent. No "Roomy wants to control Finder" prompt.
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        if ctx.delete(path).is_ok() {
            return Ok(());
        }
        // E.g. an App Store app owned by root: Finder knows how to ask for
        // the administrator password.
        ctx.set_delete_method(DeleteMethod::Finder);
    }
    ctx.delete(path).map_err(|e| e.to_string())
}

/// Deletes as much of `path` as possible. Returns (bytes freed, files left).
fn remove_best_effort(path: &Path) -> (u64, u64) {
    let Ok(md) = fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if !md.is_dir() {
        let size = scan::file_meta(&md).size;
        return match remove_file(path, &md) {
            Ok(()) => (size, 0),
            Err(_) => (0, 1),
        };
    }
    let mut freed = 0u64;
    let mut skipped = 0u64;
    match fs::read_dir(path) {
        Ok(rd) => {
            for entry in rd.flatten() {
                let (f, s) = remove_best_effort(&entry.path());
                freed += f;
                skipped += s;
            }
        }
        Err(_) => skipped += 1,
    }
    if skipped == 0 && fs::remove_dir(path).is_err() {
        skipped += 1;
    }
    (freed, skipped)
}

fn remove_file(path: &Path, md: &fs::Metadata) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) => {
            // Windows refuses to delete read-only files.
            let mut perms = md.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            if perms.readonly() {
                perms.set_readonly(false);
                if fs::set_permissions(path, perms).is_ok() {
                    return fs::remove_file(path);
                }
            }
            Err(e)
        }
    }
}

impl ScanData {
    /// Part of `path` was deleted: subtract it from the folder and everything above.
    pub fn shrink(&mut self, path: &Path, bytes: u64, files: u64) {
        let Ok(rel) = path.strip_prefix(&self.root) else {
            return;
        };
        let comps: Vec<String> = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        let mut node = &mut self.tree;
        node.size = node.size.saturating_sub(bytes);
        node.files = node.files.saturating_sub(files);
        for c in &comps {
            let Some(idx) = node.children.iter().position(|ch| ch.name.as_ref() == c.as_str()) else {
                return;
            };
            node = &mut node.children[idx];
            node.size = node.size.saturating_sub(bytes);
            node.files = node.files.saturating_sub(files);
        }
    }
}

/// Size and item count of the Trash, when it can be read.
pub fn trash_info() -> Option<(u64, u64)> {
    #[cfg(target_os = "macos")]
    {
        let trash = dirs::home_dir()?.join(".Trash");
        let rd = fs::read_dir(&trash).ok()?;
        let mut size = 0u64;
        let mut items = 0u64;
        for entry in rd.flatten() {
            if entry.file_name() == ".DS_Store" {
                continue;
            }
            size += scan::measure(&entry.path()).0;
            items += 1;
        }
        Some((size, items))
    }
    #[cfg(windows)]
    {
        Some(recycle_bin_info())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}

/// Empties the Trash / Recycle Bin. Returns the bytes freed (0 if unknown).
pub fn empty_trash() -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        let trash = dirs::home_dir().ok_or("no home folder")?.join(".Trash");
        if let Ok(rd) = fs::read_dir(&trash) {
            let mut freed = 0u64;
            for entry in rd.flatten() {
                freed += remove_best_effort(&entry.path()).0;
            }
            return Ok(freed);
        }
        // No Full Disk Access: ask Finder to do it.
        let out = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", "tell application \"Finder\" to empty trash"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(0)
        } else {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            // -1728 & co: the Trash was already empty.
            if msg.contains("-1728") || msg.is_empty() {
                Ok(0)
            } else {
                Err(msg)
            }
        }
    }
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
        let (size, items) = recycle_bin_info();
        if items == 0 {
            return Ok(0);
        }
        unsafe {
            SHEmptyRecycleBinW(
                None,
                windows::core::PCWSTR::null(),
                SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
            )
            .map_err(|e| e.message().to_string())?;
        }
        Ok(size)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Err("not supported".into())
    }
}

/// (bytes, items) in the Recycle Bin of all drives.
#[cfg(windows)]
pub fn recycle_bin_info() -> (u64, u64) {
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        if SHQueryRecycleBinW(windows::core::PCWSTR::null(), &mut info).is_ok() {
            // Copy first: the struct is packed on 32-bit Windows.
            let size = info.i64Size;
            let items = info.i64NumItems;
            return (size.max(0) as u64, items.max(0) as u64);
        }
    }
    (0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permanent_delete_updates_scan() {
        let dir = std::env::temp_dir().join(format!("roomy-del-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("keep")).unwrap();
        fs::create_dir_all(dir.join("gone/sub")).unwrap();
        fs::write(dir.join("keep/a.bin"), vec![1u8; 50_000]).unwrap();
        fs::write(dir.join("gone/b.bin"), vec![1u8; 70_000]).unwrap();
        fs::write(dir.join("gone/sub/c.bin"), vec![1u8; 90_000]).unwrap();
        fs::write(dir.join("loose.bin"), vec![1u8; 30_000]).unwrap();

        let progress = scan::Progress::default();
        let mut data = scan::scan(&dir, &progress);
        let total = data.tree.size;
        let gone = data.size_of(&dir.join("gone"));

        let out = delete(
            &DeleteRequest {
                path: dir.join("gone").to_string_lossy().into_owned(),
                mode: "permanent".into(),
                cleanup: false,
            },
            Some(&mut data),
        );
        assert!(out.ok, "{out:?}");
        assert_eq!(out.freed, gone);
        assert!(!dir.join("gone").exists());
        assert_eq!(data.tree.size, total - gone);
        assert_eq!(data.tree.files, 2);

        let out = delete(
            &DeleteRequest {
                path: dir.join("loose.bin").to_string_lossy().into_owned(),
                mode: "permanent".into(),
                cleanup: false,
            },
            Some(&mut data),
        );
        assert!(out.ok);
        assert_eq!(data.tree.files, 1);
        assert_eq!(data.tree.size, data.size_of(&dir.join("keep")));

        // Protected paths are refused, whatever the mode.
        let home = dirs::home_dir().unwrap();
        let out = delete(
            &DeleteRequest {
                path: home.to_string_lossy().into_owned(),
                mode: "trash".into(),
                cleanup: false,
            },
            None,
        );
        assert!(!out.ok);
        assert_eq!(out.error.as_deref(), Some("protected"));
        assert!(home.exists());

        fs::remove_dir_all(&dir).unwrap();
    }
}
