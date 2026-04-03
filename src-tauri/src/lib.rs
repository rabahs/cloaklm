// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use tauri::Manager;
use tauri::RunEvent;
use tauri::Emitter;
use std::sync::Mutex;

use std::sync::atomic::{AtomicBool, Ordering};

struct AppState {
    sidecar_child: Mutex<Option<CommandChild>>,
    is_shutting_down: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Initialize AppState
            app.manage(AppState {
                sidecar_child: Mutex::new(None),
                is_shutting_down: AtomicBool::new(false),
            });

            // Monitoring Loop (Async)
            tauri::async_runtime::spawn(async move {
                loop {
                    // Check if we are shutting down before starting
                    if app_handle.state::<AppState>().is_shutting_down.load(Ordering::Relaxed) {
                        break;
                    }

                    println!("🚀 Spawning CloakLM sidecar...");
                    let sidecar_command = app_handle.shell().sidecar("cloaklm-sidecar");
                    
                    if let Ok(cmd) = sidecar_command {
                        if let Ok((mut rx, child)) = cmd.spawn() {
                            // Store current child for cleanup
                            {
                                let state = app_handle.state::<AppState>();
                                let mut child_lock = state.sidecar_child.lock().unwrap();
                                *child_lock = Some(child);
                            }

                            // Process events until the process ends
                            while let Some(event) = rx.recv().await {
                                if let CommandEvent::Stdout(line) = event {
                                    let output = String::from_utf8_lossy(&line);
                                    if output.contains("CLOAKLM_PORT=") {
                                        if let Some(port_str) = output.split("CLOAKLM_PORT=").nth(1) {
                                            let port = port_str.trim().parse::<u16>().unwrap_or(4321);
                                            println!("🛡️ Sidecar ready on port {}", port);
                                            app_handle.emit("sidecar-ready", port).ok();
                                        }
                                    }
                                } else if let CommandEvent::Stderr(line) = event {
                                    eprintln!("sidecar err: {}", String::from_utf8_lossy(&line));
                                }
                            }
                            
                            // If we reach here, the receiver ended (sidecar exited)
                            println!("⚠️ Sidecar disconnected.");
                            {
                                let state = app_handle.state::<AppState>();
                                let mut child_lock = state.sidecar_child.lock().unwrap();
                                *child_lock = None;
                            }
                        } else {
                            eprintln!("Failed to spawn sidecar.");
                        }
                    } else {
                        eprintln!("Sidecar binary not found in configuration.");
                    }

                    // Check if we are shutting down before waiting/restarting
                    if app_handle.state::<AppState>().is_shutting_down.load(Ordering::Relaxed) {
                        break;
                    }

                    eprintln!("🔄 Restarting sidecar in 3 seconds...");
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { api: _, .. } | RunEvent::Exit => {
                let state = app_handle.state::<AppState>();
                state.is_shutting_down.store(true, Ordering::Relaxed);
                
                let child_to_kill = state
                    .sidecar_child
                    .lock()
                    .unwrap()
                    .take();
                if let Some(child) = child_to_kill {
                    println!("🛑 Killing sidecar on exit...");
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
