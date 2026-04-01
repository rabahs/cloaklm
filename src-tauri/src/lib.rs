// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use tauri::Manager;
use tauri::RunEvent;
use std::sync::Mutex;

struct AppState {
    sidecar_child: Mutex<Option<CommandChild>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let sidecar_command = app.shell().sidecar("cloaklm-sidecar");
            
            if let Ok(cmd) = sidecar_command {
                if let Ok((mut rx, child)) = cmd.spawn() {
                    app.manage(AppState {
                        sidecar_child: Mutex::new(Some(child)),
                    });

                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            if let CommandEvent::Stdout(line) = event {
                                println!("sidecar out: {}", String::from_utf8_lossy(&line));
                            } else if let CommandEvent::Stderr(line) = event {
                                eprintln!("sidecar err: {}", String::from_utf8_lossy(&line));
                            }
                        }
                    });
                } else {
                    eprintln!("Failed to spawn sidecar. Running in UI-only mode.");
                    app.manage(AppState {
                        sidecar_child: Mutex::new(None),
                    });
                }
            } else {
                eprintln!("Sidecar command 'cloaklm-sidecar' not found in configuration. Running in UI-only mode.");
                app.manage(AppState {
                    sidecar_child: Mutex::new(None),
                });
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { api: _, .. } | RunEvent::Exit => {
                let child_to_kill = app_handle
                    .state::<AppState>()
                    .sidecar_child
                    .lock()
                    .unwrap()
                    .take();
                if let Some(mut child) = child_to_kill {
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
