//! The disk scanner.
//!
//! Walks the whole system volume in parallel and keeps two things in memory:
//!
//! * a tree of **directories** with their recursive size and file count, and
//! * a flat list of every **big file** (and big package, e.g. a Photos library).
//!
//! Plain files are not kept in the tree. A folder listing reads the directory
//! again and only asks the tree for the sizes of its sub-folders, so memory
//! stays small even on disks with millions of files.

use rayon::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// Files at least this large are remembered individually.
pub const BIG_FILE_MIN: u64 = 10 * 1024 * 1024;

#[derive(Debug, Default)]
pub struct DirNode {
    pub name: Box<str>,
    /// Bytes on disk, including everything below.
    pub size: u64,
    /// Number of files, including everything below.
    pub files: u64,
    /// Sub-directories only.
    pub children: Vec<DirNode>,
    /// The directory could not be read (no permission).
    pub denied: bool,
    /// A bundle that the OS shows as a single item (`.app`, `.photoslibrary`, …).
    pub package: bool,
}

#[derive(Debug, Clone)]
pub struct BigFile {
    pub path: String,
    pub size: u64,
    /// Unix seconds.
    pub modified: i64,
    pub package: bool,
}

/// Live counters, shared with the UI while a scan runs.
#[derive(Default)]
pub struct Progress {
    pub files: AtomicU64,
    pub bytes: AtomicU64,
    pub current: Mutex<String>,
    pub cancel: AtomicBool,
}

pub struct ScanData {
    pub root: PathBuf,
    pub tree: DirNode,
    pub big: Vec<BigFile>,
    pub duration_ms: u64,
    /// Unix seconds.
    pub finished: i64,
}

struct Ctx<'a> {
    progress: &'a Progress,
    big: Mutex<Vec<BigFile>>,
    /// (device, inode) of hard-linked files that were already counted.
    links: Mutex<HashSet<(u64, u64)>>,
    /// Devices we are allowed to descend into (unix only).
    #[cfg_attr(not(unix), allow(dead_code))]
    devices: Vec<u64>,
    /// Directories that are never entered.
    skip: Vec<PathBuf>,
}

pub struct FileMeta {
    pub size: u64,
    pub modified: i64,
    pub link_key: Option<(u64, u64)>,
}

#[cfg(unix)]
pub fn file_meta(md: &fs::Metadata) -> FileMeta {
    use std::os::unix::fs::MetadataExt;
    FileMeta {
        // Allocated blocks, not the logical length: correct for sparse files,
        // compressed files and cloud files that are not downloaded.
        size: md.blocks().saturating_mul(512),
        modified: md.mtime(),
        link_key: if md.nlink() > 1 && !md.is_dir() {
            Some((md.dev(), md.ino()))
        } else {
            None
        },
    }
}

#[cfg(windows)]
pub fn file_meta(md: &fs::Metadata) -> FileMeta {
    use std::os::windows::fs::MetadataExt;
    const OFFLINE: u32 = 0x0000_1000;
    const RECALL_ON_OPEN: u32 = 0x0004_0000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
    let attrs = md.file_attributes();
    // OneDrive & co: placeholders take (almost) no space on this disk.
    let cloud_only = attrs & (OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS) != 0;
    FileMeta {
        size: if cloud_only { 0 } else { md.file_size() },
        modified: (md.last_write_time() / 10_000_000) as i64 - 11_644_473_600,
        link_key: None,
    }
}

/// Bundles that Finder shows as one item. Nothing inside them is listed.
pub fn is_package_name(name: &str) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let Some(dot) = name.rfind('.') else {
        return false;
    };
    let ext = &name[dot + 1..];
    const PACKAGES: &[&str] = &[
        "app",
        "photoslibrary",
        "musiclibrary",
        "tvlibrary",
        "imovielibrary",
        "theater",
        "fcpbundle",
        "logicx",
        "band",
        "sparsebundle",
        "pvm",
        "vmwarevm",
        "utm",
        "xcarchive",
        "rtfd",
        "framework",
        "bundle",
        "plugin",
        "kext",
        "appex",
        "xpc",
        "prefPane",
        "saver",
        "component",
        "vst",
        "vst3",
        "playground",
        "xcodeproj",
        "xcworkspace",
        "dSYM",
        "docset",
        "key",
        "pages",
        "numbers",
        "pkg",
        "mpkg",
        "download",
    ];
    PACKAGES.iter().any(|p| p.eq_ignore_ascii_case(ext))
}

impl Ctx<'_> {
    #[cfg(unix)]
    fn skip_dir(&self, path: &Path, entry: &fs::DirEntry) -> bool {
        use std::os::unix::fs::MetadataExt;
        if self.skip.iter().any(|s| s == path) {
            return true;
        }
        let Ok(md) = entry.metadata() else {
            return true;
        };
        // Stay on the system disk: no external drives, network shares, /dev …
        if !self.devices.contains(&md.dev()) {
            return true;
        }
        #[cfg(target_os = "macos")]
        {
            use std::os::darwin::fs::MetadataExt as _;
            // A cloud folder whose listing is not on this Mac. Reading it
            // would make the system download it.
            const SF_DATALESS: u32 = 0x4000_0000;
            if md.st_flags() & SF_DATALESS != 0 {
                return true;
            }
        }
        false
    }

    #[cfg(not(unix))]
    fn skip_dir(&self, path: &Path, _entry: &fs::DirEntry) -> bool {
        self.skip.iter().any(|s| s == path)
    }
}

fn scan_dir(path: &Path, name: Box<str>, ctx: &Ctx, in_package: bool, depth: u32) -> DirNode {
    let mut node = DirNode {
        name,
        ..Default::default()
    };
    if ctx.progress.cancel.load(Ordering::Relaxed) {
        return node;
    }
    let rd = match fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => {
            node.denied = true;
            return node;
        }
    };
    if depth <= 3 {
        if let Ok(mut cur) = ctx.progress.current.lock() {
            *cur = path.to_string_lossy().into_owned();
        }
    }

    let mut subdirs: Vec<(PathBuf, Box<str>, bool)> = Vec::new();
    let mut size = 0u64;
    let mut files = 0u64;

    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            let p = entry.path();
            if ctx.skip_dir(&p, &entry) {
                continue;
            }
            let nm = entry.file_name().to_string_lossy().into_owned();
            let pkg = is_package_name(&nm);
            subdirs.push((p, nm.into_boxed_str(), pkg));
        } else {
            let Ok(md) = entry.metadata() else { continue };
            let m = file_meta(&md);
            if let Some(key) = m.link_key {
                let mut links = ctx.links.lock().unwrap();
                if !links.insert(key) {
                    continue;
                }
            }
            size += m.size;
            files += 1;
            if m.size >= BIG_FILE_MIN && !in_package && ft.is_file() {
                ctx.big.lock().unwrap().push(BigFile {
                    path: entry.path().to_string_lossy().into_owned(),
                    size: m.size,
                    modified: m.modified,
                    package: false,
                });
            }
        }
    }

    ctx.progress.files.fetch_add(files, Ordering::Relaxed);
    ctx.progress.bytes.fetch_add(size, Ordering::Relaxed);

    let children: Vec<DirNode> = subdirs
        .into_par_iter()
        .map(|(p, nm, pkg)| {
            let mut child = scan_dir(&p, nm, ctx, in_package || pkg, depth + 1);
            child.package = pkg;
            if pkg || in_package {
                // Nobody browses inside a bundle: keep the total, drop the detail.
                child.children = Vec::new();
            }
            if pkg && !in_package && child.size >= BIG_FILE_MIN {
                let modified = fs::metadata(&p).map(|md| file_meta(&md).modified).unwrap_or(0);
                ctx.big.lock().unwrap().push(BigFile {
                    path: p.to_string_lossy().into_owned(),
                    size: child.size,
                    modified,
                    package: true,
                });
            }
            child
        })
        .collect();

    for c in &children {
        size += c.size;
        files += c.files;
    }
    node.size = size;
    node.files = files;
    node.children = children;
    node
}

/// Scan `root`. Blocks until done (or cancelled through `progress.cancel`).
pub fn scan(root: &Path, progress: &Progress) -> ScanData {
    let started = Instant::now();

    #[allow(unused_mut)]
    let mut devices: Vec<u64> = Vec::new();
    #[allow(unused_mut)]
    let mut skip: Vec<PathBuf> = Vec::new();

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(md) = fs::metadata(root) {
            devices.push(md.dev());
        }
    }
    #[cfg(target_os = "macos")]
    if root == Path::new("/") {
        use std::os::unix::fs::MetadataExt;
        // The read-only system volume and the data volume are two devices that
        // macOS presents as one disk. `/System/Volumes/Data` is the same data
        // again (reachable through firmlinks), so it must not be walked twice.
        if let Ok(md) = fs::metadata("/System/Volumes/Data") {
            devices.push(md.dev());
        }
        if let Some(home) = dirs::home_dir() {
            if let Ok(md) = fs::metadata(&home) {
                if !devices.contains(&md.dev()) {
                    devices.push(md.dev());
                }
            }
        }
        // Other disks are scanned on their own (see `platform::list_disks`).
        skip.push(PathBuf::from("/System/Volumes"));
        skip.push(PathBuf::from("/Volumes"));
        skip.push(PathBuf::from("/dev"));
    }

    let ctx = Ctx {
        progress,
        big: Mutex::new(Vec::new()),
        links: Mutex::new(HashSet::new()),
        devices,
        skip,
    };

    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 16);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .stack_size(16 * 1024 * 1024)
        .thread_name(|i| format!("roomy-scan-{i}"))
        .build()
        .expect("scan thread pool");

    let root_name: Box<str> = root.to_string_lossy().into_owned().into_boxed_str();
    let tree = pool.install(|| scan_dir(root, root_name, &ctx, false, 0));

    let mut big = ctx.big.into_inner().unwrap();
    big.sort_unstable_by(|a, b| b.size.cmp(&a.size));

    ScanData {
        root: root.to_path_buf(),
        tree,
        big,
        duration_ms: started.elapsed().as_millis() as u64,
        finished: now_unix(),
    }
}

pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn name_eq(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b) || a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}

fn components(root: &Path, path: &Path) -> Option<Vec<String>> {
    let rel = path.strip_prefix(root).ok()?;
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect(),
    )
}

impl DirNode {
    fn child(&self, name: &str) -> Option<&DirNode> {
        self.children.iter().find(|c| name_eq(&c.name, name))
    }

    /// Removes `comps` below this node and returns the (bytes, files) that
    /// went away. `file_size` is used when the last component is a plain file.
    fn remove(&mut self, comps: &[String], file_size: u64) -> (u64, u64) {
        let Some(first) = comps.first() else {
            return (0, 0);
        };
        let removed = if let Some(idx) = self.children.iter().position(|c| name_eq(&c.name, first)) {
            if comps.len() == 1 {
                let c = self.children.remove(idx);
                (c.size, c.files)
            } else {
                self.children[idx].remove(&comps[1..], file_size)
            }
        } else if comps.len() == 1 {
            (file_size, 1)
        } else {
            (0, 0)
        };
        self.size = self.size.saturating_sub(removed.0);
        self.files = self.files.saturating_sub(removed.1);
        removed
    }
}

impl ScanData {
    /// The directory node for `path`, if it was scanned.
    pub fn find(&self, path: &Path) -> Option<&DirNode> {
        let comps = components(&self.root, path)?;
        let mut node = &self.tree;
        for c in &comps {
            node = node.child(c)?;
        }
        Some(node)
    }

    pub fn size_of(&self, path: &Path) -> u64 {
        self.find(path).map(|n| n.size).unwrap_or(0)
    }

    /// Forget a deleted file or folder and fix every total above it.
    pub fn forget(&mut self, path: &Path, file_size: u64) {
        if let Some(comps) = components(&self.root, path) {
            self.tree.remove(&comps, file_size);
        }
        let p = path.to_string_lossy();
        let prefix_a = format!("{p}/");
        let prefix_b = format!("{p}\\");
        self.big
            .retain(|f| f.path != p && !f.path.starts_with(&prefix_a) && !f.path.starts_with(&prefix_b));
    }
}

/// Size of one file or folder, measured right now (independent of a scan).
/// Returns (bytes, files).
pub fn measure(path: &Path) -> (u64, u64) {
    let Ok(md) = fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if !md.is_dir() {
        return (file_meta(&md).size, 1);
    }
    measure_dir(path)
}

fn measure_dir(path: &Path) -> (u64, u64) {
    let Ok(rd) = fs::read_dir(path) else {
        return (0, 0);
    };
    let mut size = 0u64;
    let mut files = 0u64;
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            subdirs.push(entry.path());
        } else if let Ok(md) = entry.metadata() {
            size += file_meta(&md).size;
            files += 1;
        }
    }
    let (s, f) = subdirs
        .par_iter()
        .map(|p| measure_dir(p))
        .reduce(|| (0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
    (size + s, files + f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![7u8; bytes]).unwrap();
    }

    #[test]
    fn scans_and_forgets() {
        let dir = std::env::temp_dir().join(format!("roomy-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        write(&dir.join("a/one.bin"), 300_000);
        write(&dir.join("a/deep/two.bin"), 200_000);
        write(&dir.join("b/three.bin"), 100_000);
        write(&dir.join("big.bin"), (BIG_FILE_MIN + 4096) as usize);

        let progress = Progress::default();
        let mut data = scan(&dir, &progress);

        assert_eq!(data.tree.files, 4);
        assert_eq!(data.tree.children.len(), 2);
        let a = data.find(&dir.join("a")).unwrap();
        assert_eq!(a.files, 2);
        assert!(a.size >= 500_000);
        assert_eq!(data.big.len(), 1);
        assert!(data.big[0].path.ends_with("big.bin"));
        assert_eq!(progress.files.load(Ordering::Relaxed), 4);

        let before = data.tree.size;
        let deep = data.size_of(&dir.join("a/deep"));
        data.forget(&dir.join("a/deep"), 0);
        assert_eq!(data.tree.size, before - deep);
        assert!(data.find(&dir.join("a/deep")).is_none());
        assert_eq!(data.find(&dir.join("a")).unwrap().files, 1);

        let big = data.big[0].size;
        let before = data.tree.size;
        data.forget(&dir.join("big.bin"), big);
        assert_eq!(data.tree.size, before - big);
        assert!(data.big.is_empty());

        let (m, f) = measure(&dir.join("b"));
        assert_eq!(f, 1);
        assert!(m >= 100_000);

        fs::remove_dir_all(&dir).unwrap();
    }
}
