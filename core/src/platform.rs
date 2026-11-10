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
    /// Where the disk is mounted: `/`, `/Volumes/Backup`, `C:\\`, `D:\\`.
    pub root: String,
    pub name: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    /// The disk the operating system runs from.
    pub system: bool,
    /// A stick, card or other disk that can be unplugged.
    pub removable: bool,
}

/// The system disk.
pub fn disk_info() -> DiskInfo {
    let root = scan_root();
    disk_info_for(&root).unwrap_or(DiskInfo {
        root: root.to_string_lossy().into_owned(),
        name: String::new(),
        total: 0,
        free: 0,
        used: 0,
        system: true,
        removable: false,
    })
}

/// `true` when `root` is the mount point of one of the disks Roomy shows.
pub fn is_disk_root(root: &Path) -> bool {
    list_disks().iter().any(|d| Path::new(&d.root) == root)
}

#[cfg(unix)]
fn usage(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    unsafe {
        let mut st: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c.as_ptr(), &mut st) != 0 {
            return None;
        }
        let frsize = st.f_frsize as u64;
        Some((st.f_blocks as u64 * frsize, st.f_bavail as u64 * frsize))
    }
}

#[cfg(unix)]
pub fn disk_info_for(root: &Path) -> Option<DiskInfo> {
    let (total, free) = usage(root)?;
    let system = root == scan_root();
    Some(DiskInfo {
        root: root.to_string_lossy().into_owned(),
        name: volume_name(root),
        total,
        free,
        used: total.saturating_sub(free),
        system,
        removable: !system,
    })
}

/// Every disk worth showing: the system disk first, then external and
/// secondary disks. Disk images, network shares and the hidden system
/// volumes are left out.
#[cfg(target_os = "macos")]
pub fn list_disks() -> Vec<DiskInfo> {
    let mut roots: Vec<PathBuf> = vec![scan_root()];
    unsafe {
        let mut mounts: *mut libc::statfs = std::ptr::null_mut();
        let count = libc::getmntinfo(&mut mounts, libc::MNT_NOWAIT);
        for i in 0..count.max(0) as usize {
            let m = &*mounts.add(i);
            let flags = m.f_flags as i64;
            let path = std::ffi::CStr::from_ptr(m.f_mntonname.as_ptr()).to_string_lossy().into_owned();
            let local = flags & libc::MNT_LOCAL as i64 != 0;
            let hidden = flags & libc::MNT_DONTBROWSE as i64 != 0;
            // Mounted installers and disk images are read-only: not storage you clean up.
            let read_only = flags & libc::MNT_RDONLY as i64 != 0;
            if path.starts_with("/Volumes/") && local && !hidden && !read_only {
                roots.push(PathBuf::from(path));
            }
        }
    }
    roots.iter().filter_map(|r| disk_info_for(r)).filter(|d| d.total > 0).collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn list_disks() -> Vec<DiskInfo> {
    disk_info_for(&scan_root()).into_iter().collect()
}

#[cfg(target_os = "macos")]
fn volume_name(root: &Path) -> String {
    use objc2_foundation::{NSFileManager, NSString};
    let fm = NSFileManager::defaultManager();
    let name = fm.displayNameAtPath(&NSString::from_str(&root.to_string_lossy())).to_string();
    if name.is_empty() || name == "/" {
        "Macintosh HD".into()
    } else {
        name
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn volume_name(_root: &Path) -> String {
    "Disk".into()
}

#[cfg(windows)]
pub fn disk_info_for(root: &Path) -> Option<DiskInfo> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeInformationW};

    let root_h = HSTRING::from(root.as_os_str());
    let mut free_caller = 0u64;
    let mut total = 0u64;
    unsafe {
        GetDiskFreeSpaceExW(&root_h, Some(&mut free_caller), Some(&mut total), None).ok()?;
    }
    let mut label = [0u16; 261];
    let mut name = String::new();
    unsafe {
        if GetVolumeInformationW(&root_h, Some(&mut label), None, None, None, None).is_ok() {
            let len = label.iter().position(|&c| c == 0).unwrap_or(label.len());
            name = String::from_utf16_lossy(&label[..len]);
        }
    }
    const DRIVE_REMOVABLE: u32 = 2;
    let removable = unsafe { GetDriveTypeW(&root_h) } == DRIVE_REMOVABLE;
    let drive = root.to_string_lossy().trim_end_matches('\\').to_string();
    let name = if name.trim().is_empty() {
        format!("{} ({drive})", if removable { "Removable Disk" } else { "Local Disk" })
    } else {
        format!("{} ({drive})", name.trim())
    };
    Some(DiskInfo {
        root: root.to_string_lossy().into_owned(),
        name,
        total,
        free: free_caller,
        used: total.saturating_sub(free_caller),
        system: root == scan_root(),
        removable,
    })
}

/// Every drive letter that is a real disk: fixed disks, sticks and cards.
/// Network drives and optical drives are left out.
#[cfg(windows)]
pub fn list_disks() -> Vec<DiskInfo> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_RAMDISK: u32 = 6;

    let mask = unsafe { GetLogicalDrives() };
    let mut disks: Vec<DiskInfo> = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let root = PathBuf::from(format!("{}:\\", (b'A' + i as u8) as char));
        let kind = unsafe { GetDriveTypeW(&HSTRING::from(root.as_os_str())) };
        if kind != DRIVE_FIXED && kind != DRIVE_REMOVABLE && kind != DRIVE_RAMDISK {
            continue;
        }
        // An empty card reader has a letter but no disk.
        if let Some(info) = disk_info_for(&root).filter(|d| d.total > 0) {
            disks.push(info);
        }
    }
    // The system disk leads the list.
    disks.sort_by_key(|d| !d.system);
    disks
}

/// The Windows folder. System tools are started by their full path, never
/// by whatever happens to be called the same further up the search path.
#[cfg(windows)]
pub fn windows_dir() -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
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
        Command::new(windows_dir().join("explorer.exe")).raw_arg(arg).spawn()
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
    let res = Command::new(windows_dir().join("explorer.exe")).arg(path).spawn();
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
