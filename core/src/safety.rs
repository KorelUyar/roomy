//! What Roomy refuses to delete.
//!
//! The UI greys these out, and `delete` checks again before touching anything.
//! The rule of thumb: you may delete what *you* put on the computer, never the
//! folders the system itself needs.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

struct Rules {
    /// These exact folders cannot be deleted (their contents can).
    exact: HashSet<String>,
    /// Nothing at or below these can be deleted.
    subtree: Vec<String>,
    /// The direct children of these cannot be deleted.
    children_of: Vec<String>,
}

/// Lower-cased, separator-normalised form used for comparisons. Both macOS
/// and Windows file systems are case-insensitive by default.
fn norm(path: &Path) -> String {
    let mut s = path.to_string_lossy().to_lowercase();
    if cfg!(windows) {
        s = s.replace('/', "\\");
    }
    while s.len() > 1 && (s.ends_with('/') || s.ends_with('\\')) {
        if cfg!(windows) && s.len() == 3 && s.ends_with(":\\") {
            break;
        }
        s.pop();
    }
    s
}

fn sep() -> char {
    if cfg!(windows) {
        '\\'
    } else {
        '/'
    }
}

fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(build_rules)
}

#[cfg(not(windows))]
fn build_rules() -> Rules {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/var/empty"));
    let mut exact: HashSet<String> = HashSet::new();
    let mut subtree: Vec<String> = Vec::new();
    let mut children_of: Vec<String> = Vec::new();

    for p in [
        "/",
        "/Applications",
        "/Applications/Utilities",
        "/Library",
        "/System",
        "/Users",
        "/Users/Shared",
        "/private",
        "/private/var",
        "/private/tmp",
        "/private/var/folders",
        "/usr",
        "/usr/local",
        "/opt",
        "/opt/homebrew",
        "/etc",
        "/var",
        "/tmp",
        "/cores",
        "/Volumes",
        "/home",
    ] {
        exact.insert(norm(Path::new(p)));
    }
    for p in [
        "/System",
        "/bin",
        "/sbin",
        "/usr/bin",
        "/usr/sbin",
        "/usr/lib",
        "/usr/libexec",
        "/usr/share",
        "/usr/standalone",
        "/private/etc",
        "/private/var/db",
        "/private/var/vm",
        "/private/var/root",
        "/private/var/protected",
        "/Library/Apple",
        "/Library/Keychains",
        "/dev",
    ] {
        subtree.push(norm(Path::new(p)));
    }
    children_of.push(norm(Path::new("/Library")));
    children_of.push(norm(Path::new("/Users")));

    exact.insert(norm(&home));
    for d in [
        "Desktop",
        "Documents",
        "Downloads",
        "Library",
        "Movies",
        "Music",
        "Pictures",
        "Public",
        "Applications",
        ".Trash",
    ] {
        exact.insert(norm(&home.join(d)));
    }
    children_of.push(norm(&home.join("Library")));
    for d in ["Library/Keychains", ".ssh", ".gnupg", "Library/Accounts"] {
        subtree.push(norm(&home.join(d)));
    }

    Rules {
        exact,
        subtree,
        children_of,
    }
}

#[cfg(windows)]
fn build_rules() -> Rules {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let root = PathBuf::from(format!("{drive}\\"));
    let home = dirs::home_dir().unwrap_or_else(|| root.join("Users").join("Default"));
    let mut exact: HashSet<String> = HashSet::new();
    let mut subtree: Vec<String> = Vec::new();
    let mut children_of: Vec<String> = Vec::new();

    exact.insert(norm(&root));
    for d in ["Users", "Users\\Public", "Program Files", "Program Files (x86)", "ProgramData"] {
        exact.insert(norm(&root.join(d)));
    }
    for d in [
        "Windows",
        "$Recycle.Bin",
        "System Volume Information",
        "Recovery",
        "Boot",
        "EFI",
        "Documents and Settings",
        "$WinREAgent",
        "$SysReset",
        "pagefile.sys",
        "hiberfil.sys",
        "swapfile.sys",
        "bootmgr",
        "BOOTNXT",
        "DumpStack.log.tmp",
    ] {
        subtree.push(norm(&root.join(d)));
    }
    // Installed programs are removed with their uninstaller (Apps tab).
    for d in ["Program Files", "Program Files (x86)", "ProgramData", "Users"] {
        children_of.push(norm(&root.join(d)));
    }

    exact.insert(norm(&home));
    for d in [
        "Desktop",
        "Documents",
        "Downloads",
        "Pictures",
        "Music",
        "Videos",
        "Favorites",
        "Links",
        "Contacts",
        "Saved Games",
        "Searches",
        "OneDrive",
        "AppData",
        "AppData\\Local",
        "AppData\\LocalLow",
        "AppData\\Roaming",
        "AppData\\Local\\Microsoft",
        "AppData\\Local\\Packages",
        "AppData\\Local\\Programs",
        "AppData\\Local\\Temp",
        "AppData\\Roaming\\Microsoft",
    ] {
        exact.insert(norm(&home.join(d)));
    }
    for d in [
        "NTUSER.DAT",
        "AppData\\Local\\Microsoft\\Windows",
        "AppData\\Roaming\\Microsoft\\Windows",
        "AppData\\Roaming\\Microsoft\\Protect",
        "AppData\\Roaming\\Microsoft\\Crypto",
        "AppData\\Roaming\\Microsoft\\Credentials",
        ".ssh",
    ] {
        subtree.push(norm(&home.join(d)));
    }
    for known in [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
        dirs::picture_dir(),
        dirs::audio_dir(),
        dirs::video_dir(),
    ]
    .into_iter()
    .flatten()
    {
        exact.insert(norm(&known));
    }

    Rules {
        exact,
        subtree,
        children_of,
    }
}

/// `path` with every symlink in its *parent* resolved (`/etc/x` →
/// `/private/etc/x`). The last component is kept as it is: deleting a symlink
/// removes the link, not what it points to.
fn resolved(path: &Path) -> Option<PathBuf> {
    let parent = path.parent()?.canonicalize().ok()?;
    Some(parent.join(path.file_name()?))
}

/// `true` when Roomy must not delete `path`.
pub fn is_protected(path: &Path) -> bool {
    let r = rules();
    check(r, path) || resolved(path).map(|p| check(r, &p)).unwrap_or(false)
}

fn check(rules: &Rules, path: &Path) -> bool {
    let p = norm(path);
    if p.is_empty() || !path.is_absolute() {
        return true;
    }
    if rules.exact.contains(&p) {
        return true;
    }
    let s = sep();
    for root in &rules.subtree {
        if p == *root || (p.starts_with(root.as_str()) && p[root.len()..].starts_with(s)) {
            return true;
        }
    }
    if let Some(parent) = path.parent() {
        let parent = norm(parent);
        if rules.children_of.contains(&parent) {
            return true;
        }
    }
    false
}

/// Cleaning caches & co. deletes *inside* folders that are themselves
/// protected (e.g. `~/Library/Caches/com.foo`). That is fine as long as the
/// item is not in a hard-protected subtree.
pub fn is_hard_protected(path: &Path) -> bool {
    hard(path) || resolved(path).map(|p| hard(&p)).unwrap_or(false)
}

fn hard(path: &Path) -> bool {
    let r = rules();
    let p = norm(path);
    if p.is_empty() || !path.is_absolute() || r.exact.contains(&p) {
        return true;
    }
    let s = sep();
    r.subtree
        .iter()
        .any(|root| p == *root || (p.starts_with(root.as_str()) && p[root.len()..].starts_with(s)))
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn protects_system_and_home_roots() {
        let home = dirs::home_dir().unwrap();
        assert!(is_protected(Path::new("/")));
        assert!(is_protected(Path::new("/System/Library/CoreServices")));
        assert!(is_protected(Path::new("/usr/bin/ssh")));
        assert!(is_protected(Path::new("/Library/Preferences")));
        assert!(is_protected(&home));
        assert!(is_protected(&home.join("Documents")));
        assert!(is_protected(&home.join("Library")));
        assert!(is_protected(&home.join("Library/Caches")));
        assert!(is_protected(&home.join("Library/Keychains/login.keychain-db")));
        assert!(is_protected(&home.join(".ssh/id_ed25519")));
        assert!(is_protected(Path::new("relative/path")));
        // Reached through the /etc and /var symlinks.
        assert!(is_protected(Path::new("/etc/hosts")));
        assert!(is_protected(Path::new("/var/db/dslocal")));
    }

    #[test]
    fn allows_user_content() {
        let home = dirs::home_dir().unwrap();
        assert!(!is_protected(&home.join("Documents/report.pdf")));
        assert!(!is_protected(&home.join("Downloads/movie.mkv")));
        assert!(!is_protected(&home.join("Library/Caches/com.example.app")));
        assert!(!is_protected(Path::new("/Applications/Example.app")));
        assert!(!is_hard_protected(&home.join("Library/Caches/com.example.app")));
        assert!(is_hard_protected(&home.join("Library")));
    }
}
