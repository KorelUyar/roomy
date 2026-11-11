//! Ending processes, and the list of the only ones Roomy may end.
//!
//! A scan (Bloat Scanner, Health) reports processes and registers them here
//! with their start time. `quit` ends nothing that is not on the list, and
//! nothing whose number has meanwhile gone to another process, so a request
//! to quit cannot be turned against other programs.
//!
//! Every list belongs to who reported it: what Health may ask to quit (an
//! app, politely) cannot be ended through the Bloat Scanner's harder way.

use std::sync::Mutex;

/// (who reported it, pid, start time in seconds since 1970)
static ALLOWED: Mutex<Vec<(&'static str, u32, u64)>> = Mutex::new(Vec::new());

/// Replaces what `source` has reported so far.
pub fn allow(source: &'static str, processes: Vec<(u32, u64)>) {
    if let Ok(mut allowed) = ALLOWED.lock() {
        allowed.retain(|(s, _, _)| *s != source);
        allowed.extend(processes.into_iter().map(|(pid, start)| (source, pid, start)));
    }
}

/// Of `pids`, those that `source` reported and that are still the same process.
pub fn still_allowed(source: &str, pids: &[u32]) -> Vec<u32> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let Ok(mut sys) = System::new() else {
        return Vec::new();
    };
    let reported: Vec<(u32, u64)> = ALLOWED
        .lock()
        .map(|a| a.iter().filter(|(s, _, _)| *s == source).map(|(_, pid, start)| (*pid, *start)).collect())
        .unwrap_or_default();
    let own = std::process::id();
    let wanted: Vec<Pid> = pids
        .iter()
        .filter(|&&p| p > 1 && p != own && reported.iter().any(|(pid, _)| *pid == p))
        .map(|&p| Pid::from_u32(p))
        .collect();
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&wanted), true, ProcessRefreshKind::nothing());
    wanted
        .iter()
        .filter(|pid| {
            // Still the process that was reported, not a newer one with its number.
            sys.process(**pid)
                .map(|process| reported.iter().any(|(p, start)| *p == pid.as_u32() && *start == process.start_time()))
                .unwrap_or(false)
        })
        .map(|pid| pid.as_u32())
        .collect()
}

/// Ends the processes among `pids` that `source` reported. Returns how many were stopped.
pub fn quit(source: &str, pids: &[u32]) -> usize {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let allowed = still_allowed(source, pids);
    let Ok(mut sys) = System::new() else {
        return 0;
    };
    let wanted: Vec<Pid> = allowed.iter().map(|&p| Pid::from_u32(p)).collect();
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&wanted), true, ProcessRefreshKind::nothing());
    let mut stopped = 0;
    for pid in &wanted {
        if let Some(process) = sys.process(*pid) {
            // Ask politely where the system supports it, insist otherwise.
            let asked = process.kill_with(sysinfo::Signal::Term).unwrap_or(false);
            if asked || process.kill() {
                stopped += 1;
            }
        }
    }
    stopped
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn start_of(pid: u32) -> u64 {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
        let mut sys = System::new().unwrap();
        sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true, ProcessRefreshKind::nothing());
        sys.process(Pid::from_u32(pid)).unwrap().start_time()
    }

    #[test]
    fn only_ends_what_was_reported() {
        let mut child = std::process::Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let pid = child.id();

        // Not reported: left alone.
        allow("test", Vec::new());
        assert_eq!(quit("test", &[pid]), 0);
        assert!(child.try_wait().unwrap().is_none(), "the process must still be running");

        // Same number, other start time (a different process): left alone.
        let start = start_of(pid);
        allow("test", vec![(pid, start + 100)]);
        assert_eq!(quit("test", &[pid]), 0);
        assert!(child.try_wait().unwrap().is_none(), "the process must still be running");

        // Reported by someone else: left alone.
        allow("test", vec![(pid, start)]);
        assert_eq!(quit("another", &[pid]), 0);
        assert!(still_allowed("another", &[pid]).is_empty());
        assert!(child.try_wait().unwrap().is_none(), "the process must still be running");

        // Reported: ended.
        assert_eq!(quit("test", &[pid]), 1);
        let _ = child.wait();
        allow("test", Vec::new());
    }
}
