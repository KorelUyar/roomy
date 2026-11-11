//! How the computer itself is doing: processor, memory, battery, the system
//! disk, and what is using the most memory right now.
//!
//! Everything here is read from the operating system. Nothing is estimated:
//! where the system does not say (a desktop has no battery, a disk does not
//! report its health), the value is simply absent.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    /// Charge right now, 0–100.
    pub percent: Option<u8>,
    pub charging: bool,
    /// Connected to power.
    pub plugged: bool,
    pub cycles: Option<u32>,
    /// What the battery still holds compared with when it was new, 0–100.
    pub max_capacity: Option<u8>,
    /// "good" | "service" (the system recommends service) | "unknown"
    pub condition: &'static str,
}

/// An app (all its processes together) or a single process.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Consumer {
    pub name: String,
    /// The app bundle or the program file: what to show the icon of.
    pub path: String,
    pub memory: u64,
    /// Share of the whole processor (all cores), 0–100.
    pub cpu: f32,
    pub pids: Vec<u32>,
    /// An app of the user that can be asked to quit.
    pub can_quit: bool,
    /// An app someone knows by name (everything else is a program in the background).
    pub app: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    /// "macOS 15.1", "Windows 11 (26100)"
    pub os: String,
    pub host: String,
    pub cpu_brand: String,
    pub cores: usize,
    /// Load of the whole processor right now, 0–100.
    pub cpu: f32,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_available: u64,
    pub swap_used: u64,
    /// "normal" | "warn" | "critical" | "unknown"
    pub pressure: &'static str,
    /// Seconds since the computer was started.
    pub uptime: u64,
    pub battery: Option<Battery>,
    /// What the system disk says about itself (S.M.A.R.T.): "ok" | "failing" | "unknown"
    pub disk_health: &'static str,
    /// What uses the most memory, biggest first.
    pub top: Vec<Consumer>,
}

/// What takes a moment to find out and hardly ever changes: asked once a minute at most.
#[derive(Clone, Default)]
struct Slow {
    battery: Option<Battery>,
    disk_health: &'static str,
}

struct State {
    sys: System,
    slow: Option<(Instant, Slow)>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

/// Apps and background programs together; the interface shows a handful of either.
const TOP: usize = 14;

/// Is this a program a person started and knows, rather than part of the system?
fn known_program(exe: &Path) -> bool {
    #[cfg(windows)]
    {
        !exe.starts_with(crate::platform::windows_dir())
    }
    #[cfg(not(windows))]
    {
        let _ = exe;
        false
    }
}

/// The app bundle a program is in: `/Applications/X.app/Contents/MacOS/x` → `/Applications/X.app`.
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let mut out = PathBuf::new();
    for part in exe.components() {
        out.push(part);
        if out.extension().map(|e| e == "app").unwrap_or(false) {
            return Some(out);
        }
    }
    None
}

/// Apps the user installed and may be asked to quit: never Roomy itself, never the system's own.
fn quittable(bundle: &Path, own: Option<&Path>) -> bool {
    if own.map(|o| o == bundle).unwrap_or(false) {
        return false;
    }
    let user_apps = dirs::home_dir().map(|h| h.join("Applications"));
    bundle.starts_with("/Applications") || user_apps.map(|a| bundle.starts_with(a)).unwrap_or(false)
}

fn consumers(sys: &System, cores: usize) -> Vec<Consumer> {
    let own_exe = std::env::current_exe().ok();
    let own_bundle = own_exe.as_deref().and_then(bundle_of);
    let mut groups: HashMap<String, (Consumer, Vec<(u32, u64)>)> = HashMap::new();
    let own_pid = sysinfo::Pid::from_u32(std::process::id());
    // Roomy is not what one came to look at: neither itself nor what it started
    // (on Windows its window is drawn by WebView2 processes of its own).
    let ours = |process: &sysinfo::Process| {
        let mut pid = Some(process.pid());
        for _ in 0..8 {
            match pid {
                Some(p) if p == own_pid => return true,
                Some(p) => pid = sys.process(p).and_then(|parent| parent.parent()),
                None => return false,
            }
        }
        false
    };
    for process in sys.processes().values() {
        let memory = process.memory();
        if memory == 0 {
            continue;
        }
        let exe = process.exe().map(Path::to_path_buf);
        let bundle = exe.as_deref().and_then(bundle_of);
        if ours(process) || (bundle.is_some() && bundle == own_bundle) || (exe.is_some() && exe == own_exe) {
            continue;
        }
        let (key, name, path) = match (&bundle, &exe) {
            (Some(b), _) => (
                b.to_string_lossy().into_owned(),
                b.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
                b.to_string_lossy().into_owned(),
            ),
            (None, Some(e)) => {
                // The whole file name: "2.1.3" is a program, not "2.1" with an ending.
                let file = e.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let name = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(&file).to_string();
                (e.to_string_lossy().into_owned(), name, e.to_string_lossy().into_owned())
            }
            (None, None) => {
                let name = process.name().to_string_lossy().into_owned();
                (name.clone(), name, String::new())
            }
        };
        let can_quit = bundle.as_deref().map(|b| quittable(b, own_bundle.as_deref())).unwrap_or(false);
        let app = bundle.is_some() || exe.as_deref().map(known_program).unwrap_or(false);
        let entry = groups.entry(key).or_insert_with(|| {
            (
                Consumer {
                    name,
                    path,
                    can_quit,
                    app,
                    ..Default::default()
                },
                Vec::new(),
            )
        });
        entry.0.memory += memory;
        entry.0.cpu += process.cpu_usage() / cores.max(1) as f32;
        entry.0.pids.push(process.pid().as_u32());
        entry.1.push((process.pid().as_u32(), process.start_time()));
    }
    let mut list: Vec<(Consumer, Vec<(u32, u64)>)> = groups.into_values().collect();
    list.sort_by(|a, b| b.0.memory.cmp(&a.0.memory));
    list.truncate(TOP);
    // Only what is shown, and only apps that may be asked, can be quit afterwards.
    crate::quit::allow(
        "health",
        list.iter().filter(|(c, _)| c.can_quit).flat_map(|(_, pids)| pids.iter().copied()).collect(),
    );
    list.into_iter().map(|(c, _)| c).collect()
}

pub fn snapshot() -> Health {
    let mut guard = match STATE.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if guard.is_none() {
        let Ok(mut sys) = System::new() else {
            return Health {
                pressure: "unknown",
                disk_health: "unknown",
                ..Default::default()
            };
        };
        // Load is the difference between two looks: take the first one now, so
        // the very first answer already has a number.
        sys.refresh_cpu_usage();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu());
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        *guard = Some(State { sys, slow: None });
    }
    let state = guard.as_mut().expect("just set");

    state.sys.refresh_cpu_usage();
    state.sys.refresh_memory();
    state.sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory().with_exe(UpdateKind::OnlyIfNotSet),
    );

    let fresh = state.slow.as_ref().map(|(at, _)| at.elapsed() < Duration::from_secs(60)).unwrap_or(false);
    if !fresh {
        state.slow = Some((Instant::now(), slow()));
    }
    let slow = state.slow.as_ref().map(|(_, s)| s.clone()).unwrap_or_default();

    let sys = &state.sys;
    let cores = sys.cpus().len();
    let total = sys.total_memory();
    let available = sys.available_memory();
    Health {
        os: System::long_os_version().unwrap_or_default(),
        host: System::host_name().unwrap_or_default(),
        cpu_brand: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
        cores,
        cpu: sys.global_cpu_usage().clamp(0.0, 100.0),
        memory_total: total,
        memory_used: sys.used_memory(),
        memory_available: available,
        swap_used: sys.used_swap(),
        pressure: pressure(total, available),
        uptime: System::uptime().unwrap_or(0),
        battery: slow.battery,
        disk_health: if slow.disk_health.is_empty() { "unknown" } else { slow.disk_health },
        top: consumers(sys, cores),
    }
}

/// Asks apps to quit the way the Dock does (they may still ask to save).
/// Only apps the last `snapshot` listed as quittable. Returns how many were asked.
pub fn quit_apps(pids: &[u32]) -> usize {
    let allowed = crate::quit::still_allowed("health", pids);
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSRunningApplication;
        let mut asked = 0;
        for pid in &allowed {
            let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(*pid as libc::pid_t) else {
                continue;
            };
            // Only the app itself is asked. Its helpers (an app inside the app) go when it goes;
            // asked on their own they would be gone even if the app then stays to have something saved.
            let inside_another = app
                .bundleURL()
                .and_then(|url| url.path())
                .map(|path| path.to_string().matches(".app/").count() > 0)
                .unwrap_or(true);
            if !inside_another && app.terminate() {
                asked += 1;
            }
        }
        asked
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = allowed;
        0
    }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn pressure(_total: u64, _available: u64) -> &'static str {
    // The kernel's own verdict: 1 normal, 2 warning, 4 critical.
    let mut level: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let name = c"kern.memorystatus_vm_pressure_level";
    let ok = unsafe { libc::sysctlbyname(name.as_ptr(), &mut level as *mut _ as *mut libc::c_void, &mut size, std::ptr::null_mut(), 0) } == 0;
    match (ok, level) {
        (true, 1) => "normal",
        (true, 2) => "warn",
        (true, 4) => "critical",
        _ => "unknown",
    }
}

#[cfg(target_os = "macos")]
fn slow() -> Slow {
    use std::process::Command;
    let mut power = Command::new("/usr/sbin/system_profiler");
    power.args(["SPPowerDataType", "-json"]);
    let battery = parse_mac_battery(&crate::tools::run(power, Duration::from_secs(10)));

    let mut disk = Command::new("/usr/sbin/diskutil");
    disk.args(["info", "-plist", "/"]);
    let text = crate::tools::run(disk, Duration::from_secs(8));
    let smart = plist::Value::from_reader_xml(std::io::Cursor::new(text.as_bytes()))
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| d.get("SMARTStatus").and_then(|s| s.as_string()).map(str::to_string));
    Slow {
        battery,
        disk_health: match smart.as_deref() {
            Some("Verified") => "ok",
            Some("Failing") => "failing",
            _ => "unknown",
        },
    }
}

/// The battery out of `system_profiler SPPowerDataType -json`. None on a Mac without one.
#[cfg(any(target_os = "macos", test))]
fn parse_mac_battery(json: &str) -> Option<Battery> {
    let root: serde_json::Value = serde_json::from_str(json.trim()).ok()?;
    let sections = root.get("SPPowerDataType")?.as_array()?;
    let info = sections.iter().find(|s| s.get("sppower_battery_health_info").is_some() || s.get("sppower_battery_charge_info").is_some())?;
    let health = info.get("sppower_battery_health_info");
    let charge = info.get("sppower_battery_charge_info");
    let yes = |v: Option<&serde_json::Value>| v.and_then(|x| x.as_str()).map(|s| s.eq_ignore_ascii_case("true") || s.eq_ignore_ascii_case("yes")).unwrap_or(false);
    let number = |v: Option<&serde_json::Value>| -> Option<u64> {
        let v = v?;
        v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim_end_matches('%').trim().parse().ok()))
    };
    let condition = match health.and_then(|h| h.get("sppower_battery_health")).and_then(|c| c.as_str()) {
        Some(c) if c.eq_ignore_ascii_case("good") || c.eq_ignore_ascii_case("normal") => "good",
        Some(c) if !c.is_empty() => "service",
        _ => "unknown",
    };
    // The charger has a section of its own, named so, with its facts directly in it.
    let plugged = sections
        .iter()
        .filter(|s| s.get("_name").and_then(|n| n.as_str()) == Some("sppower_ac_charger_information"))
        .any(|s| yes(s.get("sppower_battery_charger_connected")));
    Some(Battery {
        percent: number(charge.and_then(|c| c.get("sppower_battery_state_of_charge"))).map(|n| n.min(100) as u8),
        charging: yes(charge.and_then(|c| c.get("sppower_battery_is_charging"))),
        plugged,
        cycles: number(health.and_then(|h| h.get("sppower_battery_cycle_count"))).map(|n| n as u32),
        max_capacity: number(health.and_then(|h| h.get("sppower_battery_health_maximum_capacity"))).map(|n| n.min(100) as u8),
        condition,
    })
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn pressure(total: u64, available: u64) -> &'static str {
    if total == 0 {
        return "unknown";
    }
    match available as f64 / total as f64 {
        share if share < 0.08 => "critical",
        share if share < 0.18 => "warn",
        _ => "normal",
    }
}

#[cfg(windows)]
const QUERY: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$o = @{}
$b = Get-CimInstance Win32_Battery | Select-Object -First 1
if ($b) {
  $o.battery = @{ percent = [int]$b.EstimatedChargeRemaining; status = [int]$b.BatteryStatus }
  $full = (Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1).FullChargedCapacity
  $design = (Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData | Select-Object -First 1).DesignedCapacity
  $cycles = (Get-CimInstance -Namespace root\wmi -ClassName BatteryCycleCount | Select-Object -First 1).CycleCount
  if ($full -and $design) { $o.battery.capacity = [int][math]::Round(100 * $full / $design) }
  if ($cycles) { $o.battery.cycles = [int]$cycles }
}
$sys = (Get-Partition -DriveLetter $env:SystemDrive.Substring(0,1) | Get-Disk | Get-PhysicalDisk | Select-Object -First 1)
if (-not $sys) { $sys = Get-PhysicalDisk | Sort-Object DeviceId | Select-Object -First 1 }
if ($sys) { $o.disk = [string]$sys.HealthStatus }
$o | ConvertTo-Json -Depth 4 -Compress
"#;

#[cfg(windows)]
fn slow() -> Slow {
    let info: serde_json::Value = serde_json::from_str(crate::tools::powershell(QUERY, Duration::from_secs(20)).trim()).unwrap_or(serde_json::Value::Null);
    let num = |v: &serde_json::Value| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64));
    let battery = info.get("battery").map(|b| {
        // Win32_Battery.BatteryStatus: 1 discharging, 2 on mains, 6–9 charging.
        let status = num(&b["status"]).unwrap_or(0);
        let capacity = num(&b["capacity"]).map(|n| n.min(100) as u8);
        Battery {
            percent: num(&b["percent"]).map(|n| n.min(100) as u8),
            charging: (6..=9).contains(&status),
            plugged: status == 2 || (6..=9).contains(&status),
            cycles: num(&b["cycles"]).map(|n| n as u32),
            max_capacity: capacity,
            condition: match capacity {
                Some(c) if c < 60 => "service",
                Some(_) => "good",
                None => "unknown",
            },
        }
    });
    Slow {
        battery,
        disk_health: match info.get("disk").and_then(|d| d.as_str()) {
            Some("Healthy") => "ok",
            // "Warning" is what a drive that predicts its own failure reports.
            Some("Unhealthy") | Some("Warning") => "failing",
            _ => "unknown",
        },
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn pressure(_total: u64, _available: u64) -> &'static str {
    "unknown"
}

#[cfg(not(any(target_os = "macos", windows)))]
fn slow() -> Slow {
    Slow::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_macbook_battery() {
        let json = r#"{ "SPPowerDataType": [
          { "_name": "spbattery_information",
            "sppower_battery_charge_info": { "sppower_battery_fully_charged": "FALSE", "sppower_battery_is_charging": "TRUE", "sppower_battery_state_of_charge": 76 },
            "sppower_battery_health_info": { "sppower_battery_cycle_count": 312, "sppower_battery_health": "Good", "sppower_battery_health_maximum_capacity": "91%" } },
          { "_name": "sppower_ac_charger_information", "sppower_ac_charger_watts": "96", "sppower_battery_charger_connected": "TRUE" }
        ] }"#;
        let b = parse_mac_battery(json).unwrap();
        assert_eq!(
            b,
            Battery {
                percent: Some(76),
                charging: true,
                plugged: true,
                cycles: Some(312),
                max_capacity: Some(91),
                condition: "good"
            }
        );
        // A desktop Mac lists power settings but no battery.
        assert!(parse_mac_battery(r#"{ "SPPowerDataType": [ { "_name": "sppower_information", "AC Power": {} } ] }"#).is_none());
        assert!(parse_mac_battery("").is_none());
    }

    #[test]
    fn snapshot_has_the_basics() {
        let h = snapshot();
        assert!(h.cores > 0);
        assert!(h.memory_total > 0 && h.memory_used <= h.memory_total);
        assert!(!h.top.is_empty());
        assert!(h.top.windows(2).all(|w| w[0].memory >= w[1].memory));
    }
}
