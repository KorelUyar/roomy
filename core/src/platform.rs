//! Small OS-specific helpers: where things are, disk capacity, "show in Finder".

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "C:\\" } else { "/" }))
}

/// The root of the disk that gets scanned.
pub fn scan_root() -> PathBuf {
    #[cfg(windows)]
    {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        PathBuf::from(format!("{drive}\\"))
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/")
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub name: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
}

#[cfg(unix)]
pub fn disk_info() -> DiskInfo {
    let mut total = 0u64;
    let mut free = 0u64;
    unsafe {
        let mut st: libc::statvfs = std::mem::zeroed();
        let root = std::ffi::CString::new("/").unwrap();
        if libc::statvfs(root.as_ptr(), &mut st) == 0 {
            let frsize = st.f_frsize as u64;
            total = st.f_blocks as u64 * frsize;
            free = st.f_bavail as u64 * frsize;
        }
    }
    DiskInfo {
        name: volume_name(),
        total,
        free,
        used: total.saturating_sub(free),
    }
}

#[cfg(target_os = "macos")]
fn volume_name() -> String {
    use objc2_foundation::{NSFileManager, NSString};
    let fm = NSFileManager::defaultManager();
    let name = fm.displayNameAtPath(&NSString::from_str("/")).to_string();
    if name.is_empty() || name == "/" {
        "Macintosh HD".into()
    } else {
        name
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn volume_name() -> String {
    "Disk".into()
}

#[cfg(windows)]
pub fn disk_info() -> DiskInfo {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetVolumeInformationW};

    let root = scan_root();
    let root_h = HSTRING::from(root.as_os_str());
    let mut free_caller = 0u64;
    let mut total = 0u64;
    let mut free_total = 0u64;
    unsafe {
        let _ = GetDiskFreeSpaceExW(
            &root_h,
            Some(&mut free_caller),
            Some(&mut total),
            Some(&mut free_total),
        );
    }
    let mut label = [0u16; 261];
    let mut name = String::new();
    unsafe {
        if GetVolumeInformationW(&root_h, Some(&mut label), None, None, None, None).is_ok() {
            let len = label.iter().position(|&c| c == 0).unwrap_or(label.len());
            name = String::from_utf16_lossy(&label[..len]);
        }
    }
    let drive = root.to_string_lossy().trim_end_matches('\\').to_string();
    let name = if name.trim().is_empty() {
        format!("Local Disk ({drive})")
    } else {
        format!("{} ({drive})", name.trim())
    };
    DiskInfo {
        name,
        total,
        free: free_caller,
        used: total.saturating_sub(free_caller),
    }
}

/// Show a file in Finder / Explorer.
pub fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let res = Command::new("/usr/bin/open").arg("-R").arg(path).spawn();
    #[cfg(windows)]
    let res = {
        use std::os::windows::process::CommandExt;
        let mut arg = std::ffi::OsString::from("/select,\"");
        arg.push(path.as_os_str());
        arg.push("\"");
        Command::new("explorer.exe").raw_arg(arg).spawn()
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let res = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .spawn();
    res.map(|_| ()).map_err(|e| e.to_string())
}

/// Open a file or folder with its default app.
pub fn open(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let res = Command::new("/usr/bin/open").arg(path).spawn();
    #[cfg(windows)]
    let res = Command::new("explorer.exe").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let res = Command::new("xdg-open").arg(path).spawn();
    res.map(|_| ()).map_err(|e| e.to_string())
}

/// macOS hides Mail, Safari, the Trash … from apps without "Full Disk Access".
pub fn has_full_disk_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        let home = home();
        // Reading these never prompts; it just fails without the permission.
        for probe in ["Library/Safari", "Library/Mail", ".Trash"] {
            let p = home.join(probe);
            if p.exists() {
                return std::fs::read_dir(&p).is_ok();
            }
        }
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn open_full_disk_access_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// "de", "en", … from the system settings.
pub fn locale() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleLanguages"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(first) = s.split('"').nth(1) {
                return first.to_string();
            }
        }
    }
    for var in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(var) {
            if !v.is_empty() && v != "C" && v != "POSIX" {
                return v.replace('_', "-");
            }
        }
    }
    "en".into()
}

/// Rough file kind from the extension. The UI uses it for icons and filters.
pub fn kind_of(name: &str, is_dir: bool, package: bool) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    if is_dir {
        return match ext.as_str() {
            "app" => "app",
            _ if package => "package",
            _ => "folder",
        };
    }
    match ext.as_str() {
        "mp4" | "mov" | "mkv" | "avi" | "m4v" | "webm" | "wmv" | "flv" | "mpg" | "mpeg" | "ts" | "m2ts" => "video",
        "jpg" | "jpeg" | "png" | "gif" | "heic" | "heif" | "tiff" | "tif" | "bmp" | "webp" | "raw" | "cr2" | "cr3"
        | "nef" | "arw" | "dng" | "psd" | "svg" | "ico" => "image",
        "mp3" | "m4a" | "wav" | "flac" | "aac" | "ogg" | "aiff" | "aif" | "wma" | "opus" => "audio",
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "cab" => "archive",
        "dmg" | "iso" | "img" | "sparseimage" | "vhd" | "vhdx" | "vmdk" | "qcow2" | "vdi" => "diskimage",
        "pkg" | "mpkg" | "msi" | "msix" | "appx" | "exe" | "xip" | "deb" | "rpm" | "apk" | "ipa" => "installer",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "pages" | "numbers" | "key" | "txt" | "rtf" | "md"
        | "epub" | "csv" | "odt" => "document",
        "js" | "tsx" | "jsx" | "py" | "rs" | "go" | "java" | "c" | "cpp" | "h" | "swift" | "json" | "xml"
        | "html" | "css" | "sh" | "yml" | "yaml" | "toml" | "sql" | "db" | "sqlite" | "jar" | "dll" | "so"
        | "dylib" | "a" | "o" | "wasm" | "bin" | "dat" | "pak" | "log" => "data",
        _ => "other",
    }
}
