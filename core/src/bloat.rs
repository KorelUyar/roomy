//! The Bloat Scanner: what is on this computer that nobody asked for, what
//! starts by itself, and whether the system's own protections are switched on.
//!
//! It reports and offers the obvious action. It is not an antivirus: it knows
//! a short list of widely unwanted software by name (`bloat_db`) and reads
//! the settings the operating system exposes.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::tools::run as run_tool;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Unwanted {
    pub id: String,
    pub name: String,
    /// "adware" | "pup" | "bundled" | "promo"
    pub reason: &'static str,
    /// Where it is (app bundle, install folder). Empty when unknown.
    pub path: String,
    /// File to show the icon of. Empty when unknown.
    pub icon: String,
    pub size: u64,
    pub running: bool,
    pub pids: Vec<u32>,
    /// "trash" (delete the app bundle), "uninstaller" (run its uninstaller),
    /// "package" (remove the store package) or "none".
    pub removal: &'static str,
    /// What to hand to the removal: bundle path, uninstall id or package name.
    pub target: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub id: String,
    pub name: String,
    /// The identifier the system knows it by (launchd label, registry value).
    pub label: String,
    /// The program that gets started. Empty when it could not be determined.
    pub program: String,
    /// The file that registers it (plist, shortcut) or the registry key.
    pub source: String,
    /// "user" (this account) or "system" (all accounts, needs an administrator).
    pub scope: &'static str,
    /// "launchAgent" | "launchDaemon" | "backgroundItem" | "runKey" | "startupFolder"
    pub kind: &'static str,
    /// Who signed the program, when known.
    pub vendor: Option<String>,
    pub running: bool,
    pub enabled: bool,
    /// "leftover": the program it starts is gone. "unsigned": not signed by an
    /// identified developer. "suspicious": starts from an unusual place.
    /// "unwanted": on the list of known unwanted software.
    pub flags: Vec<&'static str>,
    /// Roomy can switch it off itself (user scope).
    pub can_disable: bool,
    pub icon: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SecurityCheck {
    /// "diskEncryption" | "firewall" | "gatekeeper" | "sip" | "updates" | "autoLogin" |
    /// "remoteLogin" | "antivirus" | "uac" | "smartScreen" | "remoteDesktop"
    pub id: &'static str,
    /// "ok" | "warn" | "info" | "unknown"
    pub status: &'static str,
    /// Extra fact for the row ("42" days since the last update …).
    pub detail: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BloatReport {
    pub unwanted: Vec<Unwanted>,
    pub startup: Vec<StartupItem>,
    pub security: Vec<SecurityCheck>,
    pub processes: usize,
    pub duration_ms: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct Proc {
    pub pid: u32,
    pub name: String,
    pub exe: Option<PathBuf>,
    /// When it was started (seconds since 1970): tells a process apart from
    /// a later one that was given the same number.
    pub start: u64,
}



/// Every process that is running right now.
pub(crate) fn processes() -> Vec<Proc> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let Ok(mut sys) = System::new() else {
        return Vec::new();
    };
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    sys.processes()
        .values()
        .map(|p| Proc {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            exe: p.exe().map(|e| e.to_path_buf()),
            start: p.start_time(),
        })
        .collect()
}

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// Processes whose executable is `program`, or lives inside `program` when
/// that is a folder (an app bundle, an install directory).
fn pids_of(procs: &[Proc], program: &Path) -> Vec<u32> {
    let inside = program.is_dir();
    let prefix = program.to_string_lossy().to_lowercase();
    procs
        .iter()
        .filter(|p| match &p.exe {
            Some(exe) if inside => {
                let e = exe.to_string_lossy().to_lowercase();
                e.starts_with(&prefix) && e[prefix.len()..].starts_with(['/', '\\'])
            }
            Some(exe) => same_path(exe, program),
            None => false,
        })
        .map(|p| p.pid)
        .collect()
}

/// Known unwanted software that is running without being an installed app
/// that was already found (a helper process, something started by hand).
#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
fn add_running_unwanted(list: &'static [crate::bloat_db::Known], procs: &[Proc], found: &mut Vec<Unwanted>) {
    use std::collections::BTreeMap;
    let covered: Vec<u32> = found.iter().flat_map(|u| u.pids.iter().copied()).collect();
    let mut groups: BTreeMap<String, Unwanted> = BTreeMap::new();
    for p in procs {
        if covered.contains(&p.pid) {
            continue;
        }
        let exe = p.exe.as_ref().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
        let Some(known) = crate::bloat_db::find(list, &[&p.name, &exe]) else {
            continue;
        };
        let entry = groups.entry(p.name.clone()).or_insert_with(|| Unwanted {
            id: format!("process:{}", p.name),
            name: p.name.clone(),
            reason: known.reason,
            path: exe.clone(),
            icon: exe.clone(),
            running: true,
            removal: "none",
            ..Default::default()
        });
        entry.pids.push(p.pid);
    }
    found.extend(groups.into_values());
}

pub fn scan() -> BloatReport {
    let started = Instant::now();
    let procs = processes();
    let mut report = BloatReport {
        processes: procs.len(),
        ..Default::default()
    };
    platform_scan(&procs, &mut report);

    // Worst first: known unwanted, then what looks odd, then the rest by name.
    let weight = |i: &StartupItem| {
        if i.flags.contains(&"unwanted") {
            0
        } else if i.flags.contains(&"suspicious") {
            1
        } else if i.flags.contains(&"leftover") {
            2
        } else if i.flags.contains(&"unsigned") {
            3
        } else {
            4
        }
    };
    report
        .startup
        .sort_by(|a, b| weight(a).cmp(&weight(b)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    report.unwanted.sort_by(|a, b| b.running.cmp(&a.running).then_with(|| b.size.cmp(&a.size)));

    let reported: Vec<(u32, u64)> = report
        .unwanted
        .iter()
        .flat_map(|u| u.pids.iter())
        .filter_map(|pid| procs.iter().find(|p| p.pid == *pid).map(|p| (p.pid, p.start)))
        .collect();
    crate::quit::allow("bloat", reported);
    report.duration_ms = started.elapsed().as_millis() as u64;
    report
}

/// Ends processes that the last scan reported as unwanted. Anything else in
/// `pids` is ignored. Returns how many were stopped.
pub fn quit(pids: &[u32]) -> usize {
    crate::quit::quit("bloat", pids)
}

#[cfg(target_os = "macos")]
pub use mac::{disable_startup, open_settings, remove_package};
#[cfg(target_os = "macos")]
use mac::platform_scan;

#[cfg(windows)]
pub use win::{disable_startup, open_settings, remove_package};
#[cfg(windows)]
use win::platform_scan;

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_scan(_procs: &[Proc], _report: &mut BloatReport) {}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn disable_startup(_id: &str) -> Result<(), String> {
    Err("not supported".into())
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn open_settings(_id: &str) -> Result<(), String> {
    Err("not supported".into())
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn remove_package(_id: &str) -> Result<(), String> {
    Err("not supported".into())
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use crate::{apps, bloat_db};
    use std::collections::HashMap;
    use std::fs;
    use std::process::Command;

    fn run(program: &str, args: &[&str]) -> String {
        let mut command = Command::new(program);
        command.args(args);
        run_tool(command, std::time::Duration::from_secs(8))
    }

    fn uid() -> u32 {
        unsafe { libc::getuid() }
    }

    /// Programs that only start something else: the interesting path is an argument.
    const LAUNCHERS: &[&str] = &[
        "/bin/sh",
        "/bin/bash",
        "/bin/zsh",
        "/usr/bin/env",
        "/usr/bin/open",
        "/usr/bin/nohup",
        "/usr/bin/caffeinate",
        "/usr/bin/osascript",
        "/usr/bin/python3",
        "/usr/bin/ruby",
        "/usr/bin/perl",
    ];

    fn expand(path: &str) -> PathBuf {
        match path.strip_prefix("~/") {
            Some(rest) => dirs::home_dir().unwrap_or_default().join(rest),
            None => PathBuf::from(path),
        }
    }

    /// The app bundle a path is in: `/Applications/X.app/Contents/MacOS/x` → `/Applications/X.app`.
    fn bundle_of(path: &Path) -> Option<PathBuf> {
        let mut out = PathBuf::new();
        for part in path.components() {
            out.push(part);
            if out.extension().map(|e| e == "app").unwrap_or(false) {
                return Some(out);
            }
        }
        None
    }

    fn is_macho(path: &Path) -> bool {
        use std::io::Read;
        let mut magic = [0u8; 4];
        let Ok(mut f) = fs::File::open(path) else {
            return false;
        };
        if f.read_exact(&mut magic).is_err() {
            return false;
        }
        matches!(
            magic,
            [0xcf, 0xfa, 0xed, 0xfe] | [0xce, 0xfa, 0xed, 0xfe] | [0xfe, 0xed, 0xfa, 0xcf] | [0xfe, 0xed, 0xfa, 0xce] | [0xca, 0xfe, 0xba, 0xbe] | [0xbe, 0xba, 0xfe, 0xca]
        )
    }

    enum Signer {
        Developer(String),
        Apple,
        Unsigned,
        Unknown,
    }

    fn signer(path: &Path) -> Signer {
        let out = run("/usr/bin/codesign", &["-dv", "--verbose=2", &path.to_string_lossy()]);
        if out.contains("not signed at all") || out.contains("Signature=adhoc") {
            return Signer::Unsigned;
        }
        let Some(authority) = out.lines().find_map(|l| l.strip_prefix("Authority=")) else {
            return Signer::Unknown;
        };
        if let Some(rest) = authority.strip_prefix("Developer ID Application: ") {
            // "Tailscale Inc. (W5364U7YZB)" → "Tailscale Inc."
            let name = rest.rsplit_once(" (").map(|(n, _)| n).unwrap_or(rest);
            return Signer::Developer(name.to_string());
        }
        if authority.starts_with("Software Signing") || authority.starts_with("Apple") {
            return Signer::Apple;
        }
        Signer::Developer(authority.to_string())
    }

    /// Places nothing honest starts from.
    fn is_odd_location(program: &Path, arguments: &[String]) -> bool {
        let p = program.to_string_lossy();
        let home = dirs::home_dir().unwrap_or_default();
        if p.starts_with("/tmp/") || p.starts_with("/private/tmp/") || p.starts_with("/var/tmp/") || p.starts_with("/private/var/tmp/") {
            return true;
        }
        if program.starts_with(home.join("Library/Caches")) || program.starts_with(home.join("Downloads")) {
            return true;
        }
        // Download-and-run one-liners.
        let joined = arguments.join(" ").to_lowercase();
        (joined.contains("curl ") || joined.contains("wget ")) && (joined.contains("| sh") || joined.contains("|sh") || joined.contains("| bash") || joined.contains("base64"))
    }

    struct Plist {
        label: String,
        arguments: Vec<String>,
        disabled: bool,
    }

    fn read_plist(path: &Path) -> Option<Plist> {
        // Only a real, small file is read: a pipe put there in its place would hold the scan up for good.
        if !fs::metadata(path).map(|md| md.is_file() && md.len() < 1024 * 1024).unwrap_or(false) {
            return None;
        }
        let dict = plist::Value::from_file(path).ok()?.into_dictionary()?;
        let label = dict.get("Label")?.as_string()?.to_string();
        let mut arguments: Vec<String> = Vec::new();
        if let Some(program) = dict.get("Program").and_then(|v| v.as_string()) {
            arguments.push(program.to_string());
        }
        if let Some(list) = dict.get("ProgramArguments").and_then(|v| v.as_array()) {
            let list: Vec<String> = list.iter().filter_map(|v| v.as_string()).map(str::to_string).collect();
            if arguments.is_empty() {
                arguments = list;
            } else {
                arguments.extend(list.into_iter().skip(1));
            }
        }
        Some(Plist {
            label,
            arguments,
            disabled: dict.get("Disabled").and_then(|v| v.as_boolean()).unwrap_or(false),
        })
    }

    /// Label → pid (None when loaded but not running) of the user's launchd services.
    fn loaded_services() -> HashMap<String, Option<u32>> {
        let mut out = HashMap::new();
        for line in run("/bin/launchctl", &["list"]).lines().skip(1) {
            let mut cols = line.split('\t');
            let (Some(pid), Some(_status), Some(label)) = (cols.next(), cols.next(), cols.next()) else {
                continue;
            };
            out.insert(label.to_string(), pid.trim().parse::<u32>().ok());
        }
        out
    }

    fn describe(
        id: String,
        label: &str,
        arguments: &[String],
        source: &Path,
        scope: &'static str,
        kind: &'static str,
        enabled: bool,
        pid: Option<u32>,
        procs: &[Proc],
    ) -> StartupItem {
        let first = arguments.first().map(|a| expand(a)).unwrap_or_default();
        // What really runs: for `sh script.sh` that is the script.
        let target = if LAUNCHERS.iter().any(|l| Path::new(l) == first) {
            arguments
                .iter()
                .skip(1)
                .map(|a| expand(a))
                .find(|p| p.is_absolute())
                .unwrap_or_else(|| first.clone())
        } else {
            first.clone()
        };
        let bundle = bundle_of(&target);
        let mut flags: Vec<&'static str> = Vec::new();
        let mut vendor = None;

        let exists = target.as_os_str().is_empty() || !target.is_absolute() || target.exists();
        if !exists {
            flags.push("leftover");
        } else if target.is_absolute() && !target.starts_with("/System") && !target.starts_with("/usr") && !target.starts_with("/bin") && !target.starts_with("/sbin") {
            let checked = bundle.clone().unwrap_or_else(|| target.clone());
            if bundle.is_some() || is_macho(&target) {
                match signer(&checked) {
                    Signer::Developer(name) => vendor = Some(name),
                    Signer::Apple => vendor = Some("Apple".into()),
                    Signer::Unsigned => flags.push("unsigned"),
                    Signer::Unknown => {}
                }
            }
        } else if target.starts_with("/System") || target.starts_with("/usr") || target.starts_with("/bin") || target.starts_with("/sbin") {
            vendor = Some("Apple".into());
        }
        if is_odd_location(&target, arguments) {
            flags.push("suspicious");
        }
        let app_name = bundle.as_ref().and_then(|b| b.file_stem()).map(|s| s.to_string_lossy().into_owned());
        if bloat_db::find(bloat_db::MAC, &[label, &target.to_string_lossy(), app_name.as_deref().unwrap_or("")]).is_some() {
            flags.push("unwanted");
        }
        let running = pid.is_some() || (exists && target.is_absolute() && !pids_of(procs, &target).is_empty());
        StartupItem {
            id,
            name: app_name.unwrap_or_else(|| label.to_string()),
            label: label.to_string(),
            program: target.to_string_lossy().into_owned(),
            source: source.to_string_lossy().into_owned(),
            scope,
            kind,
            vendor,
            running,
            enabled,
            flags,
            can_disable: scope == "user" && kind == "launchAgent",
            icon: bundle
                .map(|b| b.to_string_lossy().into_owned())
                .unwrap_or_else(|| if exists { target.to_string_lossy().into_owned() } else { String::new() }),
        }
    }

    fn startup(procs: &[Proc]) -> Vec<StartupItem> {
        let home = dirs::home_dir().unwrap_or_default();
        let loaded = loaded_services();
        let mut items: Vec<StartupItem> = Vec::new();
        let mut seen: Vec<String> = Vec::new();

        let places: [(PathBuf, &'static str, &'static str); 3] = [
            (home.join("Library/LaunchAgents"), "user", "launchAgent"),
            (PathBuf::from("/Library/LaunchAgents"), "system", "launchAgent"),
            (PathBuf::from("/Library/LaunchDaemons"), "system", "launchDaemon"),
        ];
        for (dir, scope, kind) in places {
            let Ok(rd) = fs::read_dir(&dir) else { continue };
            for entry in rd.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e != "plist").unwrap_or(true) {
                    continue;
                }
                let Some(plist) = read_plist(&path) else { continue };
                if plist.label.starts_with("com.apple.") {
                    continue;
                }
                let pid = loaded.get(&plist.label).copied().flatten();
                seen.push(plist.label.clone());
                items.push(describe(
                    path.to_string_lossy().into_owned(),
                    &plist.label,
                    &plist.arguments,
                    &path,
                    scope,
                    kind,
                    !plist.disabled,
                    pid,
                    procs,
                ));
            }
        }

        // Background items that apps register themselves (System Settings → Login Items).
        // They have no file in the LaunchAgents folders; launchd knows where they come from.
        let domain = format!("gui/{}", uid());
        for (label, pid) in &loaded {
            if seen.contains(label) || label.starts_with("com.apple.") || label.starts_with("application.") || !label.contains('.') {
                continue;
            }
            let info = run("/bin/launchctl", &["print", &format!("{domain}/{label}")]);
            let field = |name: &str| {
                info.lines()
                    .map(str::trim)
                    .find_map(|l| l.strip_prefix(name))
                    .map(|v| v.trim().to_string())
            };
            let Some(program) = field("program = ") else { continue };
            let source = field("path = ").unwrap_or_default();
            // Only what an installed app brought along; everything else is the system's own.
            if bundle_of(Path::new(&program)).is_none() && bundle_of(Path::new(&source)).is_none() {
                continue;
            }
            items.push(describe(
                format!("label:{label}"),
                label,
                &[program],
                Path::new(&source),
                "user",
                "backgroundItem",
                true,
                *pid,
                procs,
            ));
        }
        items
    }

    fn unwanted(procs: &[Proc]) -> Vec<Unwanted> {
        let mut found: Vec<Unwanted> = apps::list()
            .into_iter()
            .filter_map(|app| {
                let known = bloat_db::find(bloat_db::MAC, &[&app.name, app.bundle_id.as_deref().unwrap_or("")])?;
                let pids = pids_of(procs, Path::new(&app.path));
                Some(Unwanted {
                    id: app.path.clone(),
                    name: app.name,
                    reason: known.reason,
                    icon: app.path.clone(),
                    target: app.path.clone(),
                    path: app.path,
                    size: app.size,
                    running: !pids.is_empty(),
                    pids,
                    removal: "trash",
                })
            })
            .collect();
        add_running_unwanted(bloat_db::MAC, procs, &mut found);
        found
    }

    fn check(id: &'static str, status: &'static str, detail: Option<String>) -> SecurityCheck {
        SecurityCheck { id, status, detail }
    }

    fn security() -> Vec<SecurityCheck> {
        let mut out = Vec::new();

        let fv = run("/usr/bin/fdesetup", &["status"]);
        out.push(check(
            "diskEncryption",
            if fv.contains("FileVault is On") {
                "ok"
            } else if fv.contains("FileVault is Off") {
                "warn"
            } else {
                "unknown"
            },
            None,
        ));

        let fw = run("/usr/libexec/ApplicationFirewall/socketfilterfw", &["--getglobalstate"]).to_lowercase();
        out.push(check(
            "firewall",
            if fw.contains("enabled") {
                "ok"
            } else if fw.contains("disabled") {
                // The way macOS ships: worth knowing, not a fault.
                "info"
            } else {
                "unknown"
            },
            None,
        ));

        let gk = run("/usr/sbin/spctl", &["--status"]);
        out.push(check(
            "gatekeeper",
            if gk.contains("assessments enabled") {
                "ok"
            } else if gk.contains("assessments disabled") {
                "warn"
            } else {
                "unknown"
            },
            None,
        ));

        let sip = run("/usr/bin/csrutil", &["status"]);
        out.push(check(
            "sip",
            if sip.contains("status: enabled") {
                "ok"
            } else if sip.contains("status: disabled") {
                "warn"
            } else {
                "unknown"
            },
            None,
        ));

        // Missing keys mean the default, which is "on".
        let pref = |key: &str| run("/usr/bin/defaults", &["read", "/Library/Preferences/com.apple.SoftwareUpdate", key]);
        let off = |key: &str| pref(key).trim() == "0";
        out.push(check(
            "updates",
            if off("AutomaticCheckEnabled") || off("CriticalUpdateInstall") {
                "warn"
            } else {
                "ok"
            },
            None,
        ));

        let auto = run("/usr/bin/defaults", &["read", "/Library/Preferences/com.apple.loginwindow", "autoLoginUser"]);
        out.push(check(
            "autoLogin",
            if auto.contains("does not exist") || auto.trim().is_empty() {
                "ok"
            } else {
                "warn"
            },
            None,
        ));

        // Remote Login (SSH): fine when it is wanted, worth knowing when it is not.
        let ssh = run("/bin/launchctl", &["print-disabled", "system"]);
        let ssh_line = ssh.lines().find(|l| l.contains("com.openssh.sshd"));
        out.push(check(
            "remoteLogin",
            match ssh_line {
                Some(l) if l.contains("enabled") || l.contains("=> false") => "info",
                Some(_) => "ok",
                None => "unknown",
            },
            None,
        ));
        out
    }

    pub(super) fn platform_scan(procs: &[Proc], report: &mut BloatReport) {
        report.unwanted = unwanted(procs);
        report.startup = startup(procs);
        report.security = security();
    }

    /// Switches off a launch agent of this user: unloads it and moves its
    /// plist to the Trash (from where it can be put back).
    pub fn disable_startup(id: &str) -> Result<(), String> {
        let path = Path::new(id);
        let agents = dirs::home_dir().ok_or("no home folder")?.join("Library/LaunchAgents");
        // Only ever a plist directly inside the user's own LaunchAgents folder.
        if path.parent() != Some(agents.as_path()) || path.extension().map(|e| e != "plist").unwrap_or(true) {
            return Err("Only your own launch agents can be switched off here.".into());
        }
        let plist = read_plist(path).ok_or("not a launch agent")?;
        let _ = Command::new("/bin/launchctl")
            .args(["bootout", &format!("gui/{}/{}", uid(), plist.label)])
            .output();
        let mut ctx = trash::TrashContext::default();
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};
            ctx.set_delete_method(DeleteMethod::NsFileManager);
        }
        ctx.delete(path).map_err(|e| e.to_string())
    }

    pub fn remove_package(_id: &str) -> Result<(), String> {
        Err("not supported on macOS".into())
    }

    /// Opens the System Settings page where a finding can be changed.
    pub fn open_settings(id: &str) -> Result<(), String> {
        let url = match id {
            "diskEncryption" => "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?FileVault",
            "firewall" => "x-apple.systempreferences:com.apple.Network-Settings.extension?Firewall",
            "gatekeeper" | "sip" => "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
            "updates" => "x-apple.systempreferences:com.apple.Software-Update-Settings.extension",
            "autoLogin" => "x-apple.systempreferences:com.apple.Users-Groups-Settings.extension",
            "remoteLogin" => "x-apple.systempreferences:com.apple.Sharing-Settings.extension",
            "loginItems" => "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
            _ => return Err("unknown setting".into()),
        };
        Command::new("/usr/bin/open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use super::*;
    use crate::{apps, bloat_db};
    use serde_json::Value;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use winreg::enums::*;
    use winreg::RegKey;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const APPROVED: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved";

    fn powershell_exe() -> PathBuf {
        crate::platform::windows_dir().join("System32\\WindowsPowerShell\\v1.0\\powershell.exe")
    }

    fn powershell(script: &str) -> String {
        let mut command = Command::new(powershell_exe());
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW);
        // Starting PowerShell and listing the store packages takes a few seconds.
        run_tool(command, std::time::Duration::from_secs(60))
    }

    /// `"C:\x\app.exe" --flag` → `C:\x\app.exe`
    fn program_of(command: &str) -> String {
        let c = command.trim();
        if let Some(rest) = c.strip_prefix('"') {
            return rest.split('"').next().unwrap_or("").to_string();
        }
        // Unquoted: the path ends at the first ".exe" (paths may contain spaces).
        let lower = c.to_lowercase();
        match lower.find(".exe") {
            Some(i) => c[..i + 4].to_string(),
            None => c.split_whitespace().next().unwrap_or("").to_string(),
        }
    }

    /// Task Manager's on/off switch for a startup entry: the first byte is
    /// even when enabled, odd when disabled.
    fn approved(hive: winreg::HKEY, list: &str, name: &str) -> bool {
        RegKey::predef(hive)
            .open_subkey(format!("{APPROVED}\\{list}"))
            .ok()
            .and_then(|k| k.get_raw_value(name).ok())
            .and_then(|v| v.bytes.first().copied())
            .map(|b| b % 2 == 0)
            .unwrap_or(true)
    }

    fn item(id: String, name: &str, command: &str, source: String, scope: &'static str, kind: &'static str, enabled: bool, procs: &[Proc]) -> StartupItem {
        let program = program_of(command);
        let path = Path::new(&program);
        let exists = program.is_empty() || !path.is_absolute() || path.exists();
        let mut flags: Vec<&'static str> = Vec::new();
        if !exists {
            flags.push("leftover");
        }
        let lower = program.to_lowercase();
        if lower.contains("\\appdata\\local\\temp\\") || lower.contains("\\windows\\temp\\") || lower.contains("\\downloads\\") {
            flags.push("suspicious");
        }
        if bloat_db::find(bloat_db::WINDOWS, &[name, &program]).is_some() {
            flags.push("unwanted");
        }
        StartupItem {
            id,
            name: name.to_string(),
            label: name.to_string(),
            running: exists && path.is_absolute() && !pids_of(procs, path).is_empty(),
            icon: if exists { program.clone() } else { String::new() },
            program,
            source,
            scope,
            kind,
            vendor: None,
            enabled,
            flags,
            can_disable: scope == "user",
        }
    }

    fn startup(procs: &[Proc]) -> Vec<StartupItem> {
        let mut out = Vec::new();
        let hives: [(&str, winreg::HKEY, u32, &str, &'static str); 3] = [
            ("HKCU", HKEY_CURRENT_USER, KEY_READ, "Run", "user"),
            ("HKLM", HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_64KEY, "Run", "system"),
            ("HKLM32", HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY, "Run32", "system"),
        ];
        for (tag, hive, flags, list, scope) in hives {
            let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(RUN, flags) else { continue };
            for (name, _value) in key.enum_values().flatten() {
                let raw: String = key.get_value(&name).unwrap_or_default();
                out.push(item(
                    format!("run:{tag}:{name}"),
                    &name,
                    &raw,
                    format!("{tag}\\{RUN}"),
                    scope,
                    "runKey",
                    approved(hive, list, &name),
                    procs,
                ));
            }
        }
        let folders: [(Option<PathBuf>, winreg::HKEY, &'static str); 2] = [
            (dirs::config_dir().map(|d| d.join("Microsoft\\Windows\\Start Menu\\Programs\\Startup")), HKEY_CURRENT_USER, "user"),
            (
                std::env::var_os("ProgramData").map(|d| PathBuf::from(d).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup")),
                HKEY_LOCAL_MACHINE,
                "system",
            ),
        ];
        for (dir, hive, scope) in folders {
            let Some(dir) = dir else { continue };
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for entry in rd.flatten() {
                let file = entry.file_name().to_string_lossy().into_owned();
                if file.eq_ignore_ascii_case("desktop.ini") {
                    continue;
                }
                let path = entry.path();
                let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(file.clone());
                let mut it = item(
                    format!("folder:{}", path.to_string_lossy()),
                    &name,
                    "",
                    path.to_string_lossy().into_owned(),
                    scope,
                    "startupFolder",
                    approved(hive, "StartupFolder", &file),
                    procs,
                );
                it.icon = path.to_string_lossy().into_owned();
                out.push(it);
            }
        }
        out
    }

    /// Everything PowerShell has to tell, in one call (starting it is the slow part).
    const QUERY: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$o = @{}
$o.packages = @(Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable } | ForEach-Object { @{ name = $_.Name; full = $_.PackageFullName; location = $_.InstallLocation } })
$mp = Get-MpComputerStatus
if ($mp) { $o.defender = @{ realtime = [bool]$mp.RealTimeProtectionEnabled; enabled = [bool]$mp.AntivirusEnabled; age = [int]$mp.AntivirusSignatureAge } }
$o.firewall = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; on = ([string]$_.Enabled -eq 'True') } })
$o.uac = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA
$o.bitlocker = (New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive).Self.ExtendedProperty('System.Volume.BitLockerProtection')
$last = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastInstallationSuccessDate
if ($last) { $o.updateDays = [int]((Get-Date) - $last).TotalDays }
$o.rdpDenied = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server').fDenyTSConnections
$o.smartscreen = [string](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer').SmartScreenEnabled
$o.smartscreenPolicy = (Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System').EnableSmartScreen
$o | ConvertTo-Json -Depth 4 -Compress
"#;

    fn check(id: &'static str, status: &'static str, detail: Option<String>) -> SecurityCheck {
        SecurityCheck { id, status, detail }
    }

    fn security(info: &Value) -> Vec<SecurityCheck> {
        let mut out = Vec::new();
        let num = |v: &Value| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64));

        out.push(match info.get("defender") {
            Some(d) => {
                let on = d["realtime"].as_bool().unwrap_or(false) && d["enabled"].as_bool().unwrap_or(false);
                let age = num(&d["age"]).unwrap_or(0);
                // Another antivirus switches Defender's real-time protection off; signatures a week old are stale.
                check("antivirus", if on && age <= 7 { "ok" } else { "warn" }, Some(age.to_string()))
            }
            None => check("antivirus", "unknown", None),
        });

        out.push(match info.get("firewall").and_then(|f| f.as_array()) {
            Some(profiles) if !profiles.is_empty() => {
                let all_on = profiles.iter().all(|p| p["on"].as_bool().unwrap_or(false));
                check("firewall", if all_on { "ok" } else { "warn" }, None)
            }
            _ => check("firewall", "unknown", None),
        });

        out.push(match info.get("bitlocker").and_then(num) {
            // 1 = on, 3 = encrypting, 5 = on (locked); 2 = off.
            Some(1) | Some(3) | Some(5) => check("diskEncryption", "ok", None),
            Some(_) => check("diskEncryption", "warn", None),
            None => check("diskEncryption", "unknown", None),
        });

        out.push(match info.get("uac").and_then(num) {
            Some(1) => check("uac", "ok", None),
            Some(_) => check("uac", "warn", None),
            None => check("uac", "unknown", None),
        });

        out.push(match info.get("updateDays").and_then(num) {
            Some(days) => check("updates", if days <= 45 { "ok" } else { "warn" }, Some(days.to_string())),
            None => check("updates", "unknown", None),
        });

        // SmartScreen is on unless someone switched it off: Windows only writes
        // the value when the setting is changed, or a policy forces it.
        let by_policy_off = info.get("smartscreenPolicy").and_then(num) == Some(0);
        out.push(match info.get("smartscreen").and_then(|s| s.as_str()) {
            Some(s) if s.eq_ignore_ascii_case("off") || by_policy_off => check("smartScreen", "warn", None),
            Some(_) => check("smartScreen", "ok", None),
            None => check("smartScreen", "unknown", None),
        });

        out.push(match info.get("rdpDenied").and_then(num) {
            Some(0) => check("remoteDesktop", "info", None),
            Some(_) => check("remoteDesktop", "ok", None),
            None => check("remoteDesktop", "unknown", None),
        });
        out
    }

    fn unwanted(info: &Value, procs: &[Proc]) -> Vec<Unwanted> {
        let mut out: Vec<Unwanted> = Vec::new();
        for app in apps::list() {
            let Some(known) = bloat_db::find(bloat_db::WINDOWS, &[&app.name, app.publisher.as_deref().unwrap_or("")]) else {
                continue;
            };
            let pids = if app.path.is_empty() { Vec::new() } else { pids_of(procs, Path::new(&app.path)) };
            out.push(Unwanted {
                id: app.id.clone(),
                name: app.name,
                reason: known.reason,
                path: app.path,
                icon: app.icon,
                size: app.size,
                running: !pids.is_empty(),
                pids,
                removal: "uninstaller",
                target: app.id,
            });
        }
        for package in info.get("packages").and_then(|p| p.as_array()).into_iter().flatten() {
            let (Some(name), Some(full)) = (package["name"].as_str(), package["full"].as_str()) else {
                continue;
            };
            let Some((display, reason)) = bloat_db::find_package(name) else { continue };
            let location = package["location"].as_str().unwrap_or("").to_string();
            let pids = if location.is_empty() { Vec::new() } else { pids_of(procs, Path::new(&location)) };
            out.push(Unwanted {
                id: format!("package:{full}"),
                name: display.to_string(),
                reason,
                size: if location.is_empty() { 0 } else { crate::scan::measure(Path::new(&location)).0 },
                path: location,
                icon: String::new(),
                running: !pids.is_empty(),
                pids,
                removal: "package",
                target: full.to_string(),
            });
        }
        add_running_unwanted(bloat_db::WINDOWS, procs, &mut out);
        out
    }

    pub(super) fn platform_scan(procs: &[Proc], report: &mut BloatReport) {
        let info: Value = serde_json::from_str(powershell(QUERY).trim()).unwrap_or(Value::Null);
        report.unwanted = unwanted(&info, procs);
        report.startup = startup(procs);
        report.security = security(&info);
    }

    /// Switches a startup entry of this user off the way Task Manager does:
    /// the entry stays, Windows just no longer starts it.
    pub fn disable_startup(id: &str) -> Result<(), String> {
        let (list, name) = if let Some(name) = id.strip_prefix("run:HKCU:") {
            ("Run", name.to_string())
        } else if let Some(path) = id.strip_prefix("folder:") {
            let user_folder = dirs::config_dir()
                .ok_or("no profile")?
                .join("Microsoft\\Windows\\Start Menu\\Programs\\Startup");
            let path = Path::new(path);
            if path.parent() != Some(user_folder.as_path()) {
                return Err("Only your own startup entries can be switched off here.".into());
            }
            ("StartupFolder", path.file_name().ok_or("bad entry")?.to_string_lossy().into_owned())
        } else {
            return Err("Only your own startup entries can be switched off here.".into());
        };
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(format!("{APPROVED}\\{list}"))
            .map_err(|e| e.to_string())?;
        // 03 = disabled, followed by the time it was switched off (FILETIME).
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| (d.as_secs() + 11_644_473_600) * 10_000_000)
            .unwrap_or(0);
        let mut bytes = vec![3u8, 0, 0, 0];
        bytes.extend_from_slice(&now.to_le_bytes());
        key.set_raw_value(&name, &winreg::RegValue { bytes, vtype: REG_BINARY })
            .map_err(|e| e.to_string())
    }

    /// Removes a Windows Store package for the current user.
    pub fn remove_package(id: &str) -> Result<(), String> {
        // Package full names are letters, digits, dots, underscores, dashes and tildes.
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '~')) {
            return Err("bad package name".into());
        }
        let status = Command::new(powershell_exe())
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("Remove-AppxPackage -Package '{id}'")])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Windows could not remove the package.".into())
        }
    }

    /// Opens the Windows Settings page where a finding can be changed.
    pub fn open_settings(id: &str) -> Result<(), String> {
        let uri = match id {
            "antivirus" => "windowsdefender://threat/",
            "firewall" => "windowsdefender://network/",
            "diskEncryption" => "ms-settings:deviceencryption",
            "updates" => "ms-settings:windowsupdate",
            "smartScreen" => "windowsdefender://appbrowser/",
            "remoteDesktop" => "ms-settings:remotedesktop",
            "uac" => "ms-settings:signinoptions",
            "loginItems" => "ms-settings:startupapps",
            _ => return Err("unknown setting".into()),
        };
        Command::new(crate::platform::windows_dir().join("explorer.exe")).arg(uri).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_stuck_tool_is_stopped() {
        let started = Instant::now();
        let mut command = std::process::Command::new("/bin/sh");
        command.args(["-c", "echo before; sleep 30; echo after"]);
        let text = run_tool(command, std::time::Duration::from_millis(300));
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        assert!(text.contains("before") && !text.contains("after"));

        let mut command = std::process::Command::new("/bin/sh");
        command.args(["-c", "echo out; echo err >&2"]);
        assert_eq!(run_tool(command, std::time::Duration::from_secs(5)), "out\nerr\n");
    }
}
