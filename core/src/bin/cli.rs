//! `roomy-cli`: the scanner without the window. Used for testing.
//!
//!   roomy-cli scan [PATH]      scan a folder (default: the whole disk) and print the biggest entries
//!   roomy-cli disks            list the disks Roomy would show
//!   roomy-cli apps             list installed apps
//!   roomy-cli bloat            run the Bloat Scanner (read-only)
//!   roomy-cli health           processor, memory, battery, disk health, what uses the most memory
//!   roomy-cli malware [full]   check files against the system's malware signatures (read-only)
//!   roomy-cli cleanup          list cleanup suggestions
//!   roomy-cli icon PATH OUT    write the icon of PATH to OUT (png)
//!   roomy-cli selftest [DIR]   run every read-only code path once (CI smoke test)
//!   roomy-cli serve PORT TOKEN the app's backend over HTTP on 127.0.0.1, for developing and
//!                              testing the interface in a normal browser

use roomy_core::engine::Engine;
use roomy_core::{apps, bloat, browse, cleanup, health, icons, malware, platform, scan};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

fn human(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1000.0 && i < UNITS.len() - 1 {
        v /= 1000.0;
        i += 1;
    }
    if i == 0 {
        format!("{bytes} B")
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

fn run_scan(root: &Path) -> scan::ScanData {
    let progress = scan::Progress::default();
    let data = scan::scan(root, &progress);
    println!(
        "scanned {} files, {} in {:.1}s ({} big files)",
        progress.files.load(Ordering::Relaxed),
        human(data.tree.size),
        data.duration_ms as f64 / 1000.0,
        data.big.len()
    );
    data
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..(i + 3).min(bytes.len())]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) if hex.len() == 2 => {
                        out.push(b);
                        i += 3;
                    }
                    _ => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| percent_decode(v))
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type, x-roomy-token\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle(stream: TcpStream, engine: &Arc<Engine>, token: &str) {
    let Ok(mut out) = stream.try_clone() else { return };
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();

    let mut content_length = 0usize;
    let mut header_token = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            match name.trim().to_ascii_lowercase().as_str() {
                "content-length" => content_length = value.trim().parse().unwrap_or(0),
                "x-roomy-token" => header_token = value.trim().to_string(),
                _ => {}
            }
        }
    }
    let mut body = vec![0u8; content_length.min(64 * 1024 * 1024)];
    if reader.read_exact(&mut body).is_err() {
        return;
    }

    if method == "OPTIONS" {
        return respond(&mut out, "204 No Content", "text/plain", b"");
    }
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    match (method.as_str(), path) {
        ("GET", "/icon") => {
            if query_param(query, "t").as_deref() != Some(token) {
                return respond(&mut out, "403 Forbidden", "text/plain", b"bad token");
            }
            let size = query_param(query, "s").and_then(|s| s.parse().ok()).unwrap_or(64);
            match query_param(query, "p").and_then(|p| icons::icon_png(Path::new(&p), size)) {
                Some(png) => respond(&mut out, "200 OK", "image/png", &png),
                None => respond(&mut out, "404 Not Found", "text/plain", b"no icon"),
            }
        }
        ("POST", "/rpc") => {
            if header_token != token {
                return respond(&mut out, "403 Forbidden", "text/plain", b"bad token");
            }
            let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
            let cmd = parsed.get("cmd").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let args = parsed.get("args").cloned().unwrap_or(serde_json::Value::Null);
            let reply = match engine.call(&cmd, args) {
                Ok(value) => serde_json::json!({ "ok": value }),
                Err(error) => serde_json::json!({ "error": error }),
            };
            respond(&mut out, "200 OK", "application/json", reply.to_string().as_bytes());
        }
        _ => respond(&mut out, "404 Not Found", "text/plain", b"not found"),
    }
}

/// The app's backend over HTTP. Only listens on this computer, and every
/// request has to carry the token: a web page cannot guess it.
fn serve(port: u16, token: String) {
    assert!(token.len() >= 16, "the token must be at least 16 characters");
    let engine = Engine::new(env!("CARGO_PKG_VERSION"));
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("could not open the port");
    println!("roomy backend on http://127.0.0.1:{port}");
    for stream in listener.incoming().flatten() {
        let engine = engine.clone();
        let token = token.clone();
        std::thread::spawn(move || handle(stream, &engine, &token));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("serve") => {
            let port: u16 = args.get(1).and_then(|p| p.parse().ok()).expect("port");
            let token = args.get(2).cloned().expect("token");
            serve(port, token);
        }
        Some("scan") => {
            let root = args.get(1).map(PathBuf::from).unwrap_or_else(platform::scan_root);
            let data = run_scan(&root);
            let mut kids: Vec<_> = data.tree.children.iter().collect();
            kids.sort_by(|a, b| b.size.cmp(&a.size));
            for c in kids.iter().take(25) {
                println!("{:>10}  {:>9} files  {}{}", human(c.size), c.files, c.name, if c.denied { "  (no access)" } else { "" });
            }
            if let Some(disk) = platform::disk_info_for(&root).filter(|_| platform::is_disk_root(&root)) {
                let ov = browse::overview(&data, disk);
                println!("\ndisk: {} — {} used of {}, {} free", ov.disk.name, human(ov.disk.used), human(ov.disk.total), human(ov.disk.free));
                for c in &ov.categories {
                    println!("{:>10}  {}", human(c.size), c.name.clone().unwrap_or(c.id.to_string()));
                }
                println!("\nlargest files:");
                for f in browse::large_files(&data, 0, 15) {
                    println!("{:>10}  {}{}", human(f.size), f.path, if f.app_data { "  [app data]" } else { "" });
                }
            }
        }
        Some("disks") => {
            for d in platform::list_disks() {
                println!(
                    "{:<28} {:<22} {:>10} used of {:>10}, {:>10} free{}{}",
                    d.name,
                    d.root,
                    human(d.used),
                    human(d.total),
                    human(d.free),
                    if d.system { "  [system]" } else { "" },
                    if d.removable { "  [external]" } else { "" }
                );
            }
        }
        Some("health") => {
            let h = health::snapshot();
            println!("{} · {} · {} ({} cores)", h.host, h.os, h.cpu_brand, h.cores);
            println!("processor {:.0} %   memory {} of {} used ({} available, pressure {})   swap {}", h.cpu, human(h.memory_used), human(h.memory_total), human(h.memory_available), h.pressure, human(h.swap_used));
            println!("up for {:.1} days   system disk: {}", h.uptime as f64 / 86400.0, h.disk_health);
            match &h.battery {
                Some(b) => println!("battery: {:?} %  charging {}  plugged {}  cycles {:?}  holds {:?} %  condition {}", b.percent, b.charging, b.plugged, b.cycles, b.max_capacity, b.condition),
                None => println!("battery: none"),
            }
            println!("\nusing the most memory:");
            for c in &h.top {
                println!("  {:<28} {:>10}  {:>5.1} %{}", c.name.chars().take(28).collect::<String>(), human(c.memory), c.cpu, if c.can_quit { "  (can be asked to quit)" } else { "" });
            }
        }
        Some("malware") => {
            let info = malware::info();
            println!("engine: {} (available {}), signatures {} version {}, updated {}", info.engine, info.available, info.rules, info.version, info.updated);
            let scope = if args.get(1).map(String::as_str) == Some("full") { "full" } else { "quick" };
            if let Err(e) = malware::start(scope) {
                eprintln!("{e}");
                std::process::exit(1);
            }
            malware::wait();
            let st = malware::status();
            println!("{} scan {}: {} files, {} read, {} unreadable, {:.1}s", st.scope, st.state, st.files, human(st.bytes), st.skipped, st.duration_ms as f64 / 1000.0);
            if let Some(e) = &st.error {
                println!("error: {e}");
            }
            for t in &st.threats {
                println!("  {}  {}{}", t.signature, t.path, if t.test { "  (test file)" } else { "" });
            }
            if st.threats.is_empty() && st.state == "done" {
                println!("nothing found");
            }
        }
        Some("bloat") => {
            let report = bloat::scan();
            println!("{} processes looked at in {:.1}s", report.processes, report.duration_ms as f64 / 1000.0);
            println!("\nunwanted software: {}", report.unwanted.len());
            for u in &report.unwanted {
                println!("  [{}] {}  {}  {}{}", u.reason, u.name, human(u.size), u.removal, if u.running { "  (running)" } else { "" });
            }
            println!("\nstartup items: {}", report.startup.len());
            for i in &report.startup {
                println!(
                    "  {:<34} {:<6} {:<14} {:<22} {}{}{}",
                    i.name.chars().take(34).collect::<String>(),
                    i.scope,
                    i.kind,
                    i.vendor.clone().unwrap_or_default().chars().take(22).collect::<String>(),
                    i.flags.join(","),
                    if i.running { "  (running)" } else { "" },
                    if i.enabled { "" } else { "  (off)" }
                );
            }
            println!("\nsecurity:");
            for c in &report.security {
                println!("  {:<16} {:<8} {}", c.id, c.status, c.detail.clone().unwrap_or_default());
            }
        }
        Some("apps") => {
            let started = std::time::Instant::now();
            let list = apps::list();
            for a in &list {
                println!(
                    "{:>10}  {:<34} {:<12} {}{}",
                    human(a.size),
                    a.name,
                    a.version.clone().unwrap_or_default(),
                    a.bundle_id.clone().or(a.publisher.clone()).unwrap_or_default(),
                    if a.running { "  (running)" } else { "" }
                );
            }
            println!("{} apps in {:.1}s", list.len(), started.elapsed().as_secs_f64());
            if let Some(target) = args.get(1) {
                for r in apps::related(target) {
                    println!("  related {:>10}  {:<12} {}", human(r.size), r.kind, r.path);
                }
            }
        }
        Some("cleanup") => {
            let started = std::time::Instant::now();
            for g in cleanup::suggestions() {
                println!("{:<14} {:>10}  {} items  [{} / {}]", g.id, human(g.size), g.items.len(), g.safety, g.mode);
                for i in g.items.iter().take(6) {
                    println!("    {:>10}  {}", human(i.size), i.name);
                }
            }
            println!("in {:.1}s", started.elapsed().as_secs_f64());
        }
        Some("icon") => {
            let path = args.get(1).expect("path");
            let out = args.get(2).expect("output file");
            match icons::icon_png(Path::new(path), 128) {
                Some(png) => {
                    std::fs::write(out, png.as_slice()).expect("write");
                    println!("wrote {} bytes to {out}", png.len());
                }
                None => {
                    eprintln!("no icon for {path}");
                    std::process::exit(1);
                }
            }
        }
        Some("selftest") => {
            let out_dir = args.get(1).map(PathBuf::from);
            let disks = platform::list_disks();
            for d in &disks {
                println!("disk: {} ({}) total {} free {}{}", d.name, d.root, human(d.total), human(d.free), if d.system { " [system]" } else { "" });
            }
            let disk = disks.iter().find(|d| d.system).expect("the system disk is listed");
            assert!(disk.total > 0, "disk size");
            assert!(disk.free <= disk.total, "free space");
            assert!(platform::is_disk_root(&platform::scan_root()), "system root is a disk root");
            println!("locale: {}  home: {}  root: {}", platform::locale(), platform::home().display(), platform::scan_root().display());

            // Scan the home folder: big enough to be meaningful, quick enough for CI.
            let data = run_scan(&platform::home());
            assert!(data.tree.files > 0, "scan found no files");
            let listing = browse::list_dir(&data, &platform::home()).expect("list home");
            println!("home has {} entries; biggest: {:?}", listing.len(), listing.first().map(|e| (&e.name, human(e.size))));

            let list = apps::list();
            println!("{} apps; first: {:?}", list.len(), list.first().map(|a| (&a.name, human(a.size))));
            if cfg!(any(target_os = "macos", windows)) {
                assert!(!list.is_empty(), "no apps found");
            }
            let mut icons_ok = 0;
            for (i, app) in list.iter().take(8).enumerate() {
                if app.icon.is_empty() {
                    continue;
                }
                if let Some(png) = icons::icon_png(Path::new(&app.icon), 64) {
                    assert!(png.starts_with(&[0x89, b'P', b'N', b'G']), "icon is not a PNG");
                    icons_ok += 1;
                    if let Some(dir) = &out_dir {
                        let _ = std::fs::create_dir_all(dir);
                        let _ = std::fs::write(dir.join(format!("icon-{i}.png")), png.as_slice());
                    }
                }
            }
            println!("icons rendered: {icons_ok}");
            if let Some(png) = icons::icon_png(&platform::home(), 64) {
                println!("folder icon: {} bytes", png.len());
                if let Some(dir) = &out_dir {
                    let _ = std::fs::write(dir.join("icon-home.png"), png.as_slice());
                }
            }

            let groups = cleanup::suggestions();
            for g in &groups {
                println!("cleanup {:<14} {:>10}  {} items", g.id, human(g.size), g.items.len());
            }
            println!("trash: {:?}", roomy_core::delete::trash_info());
            println!("full disk access: {}", platform::has_full_disk_access());
            let report = bloat::scan();
            println!(
                "bloat scan: {} processes, {} unwanted, {} startup items, {} security checks in {} ms",
                report.processes,
                report.unwanted.len(),
                report.startup.len(),
                report.security.len(),
                report.duration_ms
            );
            for c in &report.security {
                println!("  security {:<16} {}", c.id, c.status);
            }
            for i in report.startup.iter().take(6) {
                println!("  startup {} [{} / {}] {}", i.name, i.scope, i.kind, i.flags.join(","));
            }
            for u in &report.unwanted {
                println!("  unwanted {} [{} / {}]", u.name, u.reason, u.removal);
            }
            let h = health::snapshot();
            println!("health: {} · {} · {} cores · processor {:.0} % · memory {} of {} · pressure {} · disk {} · battery {}", h.os, h.cpu_brand, h.cores, h.cpu, human(h.memory_used), human(h.memory_total), h.pressure, h.disk_health, if h.battery.is_some() { "yes" } else { "none" });
            assert!(h.cores > 0 && h.memory_total > 0, "no health data");
            // Which engine there is (no scan here: on Windows that is Defender's business and takes minutes).
            let engine = malware::info();
            println!("malware engine: {} · available {} · {} signatures · version {}", engine.engine, engine.available, engine.rules, engine.version);
            assert!(report.processes > 0, "no processes listed");
            assert!(!report.security.is_empty(), "no security checks");
            println!("selftest ok");
        }
        _ => {
            eprintln!("usage: roomy-cli scan [PATH] | disks | apps [APP] | cleanup | bloat | health | malware [full] | icon PATH OUT | selftest [DIR] | serve PORT TOKEN");
            std::process::exit(2);
        }
    }
}
