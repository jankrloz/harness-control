#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
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

    if let Ok(child) = Command::new("harness-controld").spawn() {
        return Some(child);
    }

    let dev_daemon = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/server/dist/daemon.js");
    if dev_daemon.exists() {
        if let Ok(child) = Command::new("node").arg(dev_daemon).spawn() {
            return Some(child);
        }
    }

    None
}

fn main() {
    let child = spawn_daemon();

    tauri::Builder::default()
        .manage(DaemonProcess(Mutex::new(child)))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<DaemonProcess>();
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut proc) = guard.take() {
                        let _ = proc.kill();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running harness-control desktop");
}
