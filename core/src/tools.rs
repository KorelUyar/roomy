//! Running the system's own tools (launchctl, diskutil, PowerShell …) without
//! ever waiting for one of them for good.

use std::time::{Duration, Instant};

/// Runs a system tool and returns what it printed (stdout, then stderr).
/// A tool that does not finish in time is stopped: one stuck command must
/// never keep the whole scan waiting.
#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub fn run(mut command: std::process::Command, timeout: std::time::Duration) -> String {
    use std::io::Read;
    use std::process::Stdio;
    use std::sync::{mpsc, Arc, Mutex};
    
    let Ok(mut child) = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    else {
        return String::new();
    };

    // Both streams are read while the tool runs, so a full pipe cannot block
    // it. What has arrived is kept in a shared buffer: it is still there when
    // the tool is stopped, or when something it started keeps the pipe open.
    let (done, finished) = mpsc::channel::<()>();
    let collect = |stream: Option<Box<dyn Read + Send>>| {
        let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
        let (into, done) = (buffer.clone(), done.clone());
        std::thread::spawn(move || {
            if let Some(mut stream) = stream {
                let mut chunk = [0u8; 8192];
                while let Ok(n) = stream.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    if let Ok(mut all) = into.lock() {
                        all.extend_from_slice(&chunk[..n]);
                    }
                }
            }
            let _ = done.send(());
        });
        buffer
    };
    let out = collect(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let err = collect(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    // The tool is gone; give the readers a moment to see the end of both streams.
    let patience = Instant::now() + Duration::from_millis(500);
    for _ in 0..2 {
        if finished.recv_timeout(patience.saturating_duration_since(Instant::now())).is_err() {
            break;
        }
    }
    let text = |buffer: &Arc<Mutex<Vec<u8>>>| buffer.lock().map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    text(&out) + &text(&err)
}


/// Windows PowerShell by its full path (never whatever is called the same
/// further up the search path), without a window, with a deadline.
#[cfg(windows)]
pub fn powershell(script: &str, timeout: Duration) -> String {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let exe = crate::platform::windows_dir().join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    // Answers in UTF-8, so names with umlauts arrive whole.
    let script = format!("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n{script}");
    let mut command = std::process::Command::new(exe);
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script.as_str()])
        .creation_flags(CREATE_NO_WINDOW);
    run(command, timeout)
}
