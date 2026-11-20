#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

struct DaemonProcess(Mutex<Option<Child>>);

fn is_daemon_running() -> bool {
    let addr: SocketAddr = "127.0.0.1:4318".parse().expect("valid socket addr");
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn spawn_daemon() -> Option<Child> {
    if is_daemon_running() {
        return None;
    }

    let candidates = [
        "harness-controld",
        "/opt/homebrew/bin/harness-controld",
        "/usr/local/bin/harness-controld",
    ];
    for bin in candidates {
        if let Ok(child) = Command::new(bin)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            return Some(child);
        }
    }

    let dev_daemon = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/server/dist/daemon.js");
    if dev_daemon.exists() {
        if let Ok(child) = Command::new("node")
            .arg(dev_daemon)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            return Some(child);
        }
    }

    None
}

fn kill_daemon(app: &tauri::AppHandle) {
    let state = app.state::<DaemonProcess>();
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut proc) = guard.take() {
            let _ = proc.kill();
            let _ = proc.wait();
        }
    }

    // Also terminate any detached daemon listening on :4318
    #[cfg(unix)]
    if let Ok(output) = Command::new("lsof").args(["-ti", "tcp:4318"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let pid = line.trim();
            if !pid.is_empty() {
                let _ = Command::new("kill").args(["-TERM", pid]).status();
            }
        }
    }
}

fn ensure_daemon_running(app: &tauri::AppHandle) {
    if is_daemon_running() {
        return;
    }
    let child = spawn_daemon();
    let state = app.state::<DaemonProcess>();
    if let Ok(mut guard) = state.0.lock() {
        *guard = child;
    };
}

fn show_main_window(app: &tauri::AppHandle) {
    ensure_daemon_running(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    let child = spawn_daemon();

    tauri::Builder::default()
        .manage(DaemonProcess(Mutex::new(child)))
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Open harness-control", true, None::<&str>)?;
            let restart_item =
                MenuItem::with_id(app, "restart", "Restart Daemon", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit harness-control", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &restart_item, &sep, &quit_item])?;

            let mut builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("harness-control")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "restart" => {
                        kill_daemon(app);
                        std::thread::sleep(Duration::from_millis(200));
                        ensure_daemon_running(app);
                    }
                    "quit" => {
                        kill_daemon(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Ok(tray_icon) =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
            {
                builder = builder.icon(tray_icon).icon_as_template(true);
            } else if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }

            let _tray = builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running harness-control desktop");
}
