mod secure_store;

use secure_store::{write_private_file, SecureStore};
use tauri::Emitter;
use tauri::Manager;
use tauri::RunEvent;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

struct AppState {
    sidecar_child: Mutex<Option<CommandChild>>,
    /// The port the running sidecar announced; None while it starts or restarts,
    /// so the webview never sends a token to a port nobody verified.
    sidecar_port: Mutex<Option<u16>>,
    is_shutting_down: AtomicBool,
    /// Full access to the sidecar. Only the webview gets it.
    app_token: String,
    /// Read-only access to the shared (redacted) documents. Written to
    /// connection.json for the cloaklm MCP server.
    tools_token: String,
    store: SecureStore,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS random number generator unavailable");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[tauri::command]
fn get_sidecar_auth(state: tauri::State<AppState>) -> String {
    state.app_token.clone()
}

#[tauri::command]
fn get_sidecar_port(state: tauri::State<AppState>) -> Option<u16> {
    *state.sidecar_port.lock().unwrap()
}

const STORE_KEYS: [&str; 3] = ["settings", "chat_sessions", "projects"];

#[tauri::command]
fn store_get(state: tauri::State<AppState>, key: String) -> Result<Option<serde_json::Value>, String> {
    if !STORE_KEYS.contains(&key.as_str()) {
        return Err("unknown store key".into());
    }
    Ok(state.store.get(&key))
}

#[tauri::command]
fn store_set(state: tauri::State<AppState>, key: String, value: serde_json::Value) -> Result<(), String> {
    if !STORE_KEYS.contains(&key.as_str()) {
        return Err("unknown store key".into());
    }
    state.store.set(&key, value).map_err(|e| e.to_string())
}

/// Asks where to save, then writes the transcript there. The webview never gets
/// general file-system access.
#[tauri::command]
async fn export_transcript(app: tauri::AppHandle, contents: String, file_name: String) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(file_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(path) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Opens the bundled cloaklm.mcpb (Claude Desktop installs it). If nothing can
/// open it, shows it in the file manager instead.
#[tauri::command]
fn install_mcp_bundle(app: tauri::AppHandle) -> Result<&'static str, String> {
    let bundle = app
        .path()
        .resolve("mcp/cloaklm.mcpb", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if app.opener().open_path(bundle.to_string_lossy(), None::<&str>).is_ok() {
        return Ok("opened");
    }
    app.opener().reveal_item_in_dir(&bundle).map_err(|e| e.to_string())?;
    Ok("revealed")
}

/// The only web pages the app opens: provider privacy settings.
#[tauri::command]
fn open_privacy_link(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let url = match name.as_str() {
        "claude" => "https://claude.ai/settings/data-privacy-controls",
        "openai" => "https://help.openai.com/en/articles/7730893-data-controls-faq",
        "gemini" => "https://ai.google.dev/gemini-api/terms",
        _ => return Err("unknown link".into()),
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Where the MCP server looks for the sidecar's port and the tools token.
fn connection_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("connection.json"))
}

fn write_connection_file(app: &tauri::AppHandle, port: u16, tools_token: &str, pid: u32) -> std::io::Result<()> {
    let path = connection_file(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app data dir"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let body = serde_json::json!({ "port": port, "token": tools_token, "pid": pid });
    write_private_file(&path, body.to_string().as_bytes())
}

fn remove_connection_file(app: &tauri::AppHandle) {
    if let Some(path) = connection_file(app) {
        let _ = std::fs::remove_file(path);
    }
}

fn open_store(app: &tauri::AppHandle) -> SecureStore {
    let dir = app.path().app_data_dir().expect("no app data dir");
    // Development binaries change on every rebuild, which would make the keychain
    // ask for permission each time; they use an owner-only key file instead.
    let key = secure_store::store_key(&dir, !cfg!(debug_assertions)).expect("could not create the store key");
    SecureStore::open(&dir, key).expect("could not open the app data store")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            app.manage(AppState {
                sidecar_child: Mutex::new(None),
                sidecar_port: Mutex::new(None),
                is_shutting_down: AtomicBool::new(false),
                app_token: random_token(),
                tools_token: random_token(),
                store: open_store(&app_handle),
            });
            // A connection.json left by a crash points at a port anything could now hold.
            remove_connection_file(&app_handle);

            // Monitoring Loop (Async)
            tauri::async_runtime::spawn(async move {
                loop {
                    // Check if we are shutting down before starting
                    if app_handle.state::<AppState>().is_shutting_down.load(Ordering::Relaxed) {
                        break;
                    }

                    println!("🚀 Spawning CloakLM sidecar...");
                    // Bare name: the bundler places externalBin "bin/cloaklm-sidecar" next to
                    // the app executable by file name only, and sidecar() resolves from there.
                    let sidecar_command = app_handle.shell().sidecar("cloaklm-sidecar");

                    if let Ok(cmd) = sidecar_command {
                        let mut cmd = cmd.args(["--tokens-stdin"]);
                        if cfg!(debug_assertions) {
                            // Lets the sidecar accept the Vite dev server's origin.
                            cmd = cmd.env("CLOAKLM_DEV", "1");
                        }
                        if let Ok((mut rx, mut child)) = cmd.spawn() {
                            // Tokens go over stdin: environment variables are readable by
                            // any program running as the user (`ps -E`). stdin then stays
                            // open, and the sidecar exits when it closes.
                            let tokens = {
                                let state = app_handle.state::<AppState>();
                                serde_json::json!({ "app": state.app_token, "tools": state.tools_token })
                            };
                            if child.write(format!("{}\n", tokens).as_bytes()).is_err() {
                                eprintln!("Could not hand tokens to the sidecar.");
                            }
                            let pid = child.pid();
                            {
                                let state = app_handle.state::<AppState>();
                                *state.sidecar_child.lock().unwrap() = Some(child);
                            }
                            // The packaged engine unpacks itself before Python can print anything.
                            app_handle.emit("sidecar-stage", "unpacking").ok();

                            // Process events until the process ends
                            while let Some(event) = rx.recv().await {
                                if let CommandEvent::Stdout(line) = event {
                                    let output = String::from_utf8_lossy(&line);
                                    if let Some(stage) = output.split("CLOAKLM_STAGE=").nth(1) {
                                        app_handle.emit("sidecar-stage", stage.trim().to_string()).ok();
                                    } else if let Some(port_str) = output.split("CLOAKLM_PORT=").nth(1) {
                                        // No fallback port: a bad line means no port, not 4321.
                                        if let Ok(port) = port_str.trim().parse::<u16>() {
                                            println!("🛡️ Sidecar ready on port {}", port);
                                            let state = app_handle.state::<AppState>();
                                            *state.sidecar_port.lock().unwrap() = Some(port);
                                            if let Err(e) = write_connection_file(&app_handle, port, &state.tools_token, pid) {
                                                eprintln!("Could not write connection.json: {}", e);
                                            }
                                            app_handle.emit("sidecar-ready", port).ok();
                                        }
                                    }
                                } else if let CommandEvent::Stderr(line) = event {
                                    eprintln!("sidecar err: {}", String::from_utf8_lossy(&line));
                                }
                            }

                            // If we reach here, the receiver ended (sidecar exited)
                            println!("⚠️ Sidecar disconnected.");
                            remove_connection_file(&app_handle);
                            {
                                let state = app_handle.state::<AppState>();
                                *state.sidecar_child.lock().unwrap() = None;
                                *state.sidecar_port.lock().unwrap() = None;
                            }
                            app_handle.emit("sidecar-down", ()).ok();
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
        .invoke_handler(tauri::generate_handler![
            get_sidecar_auth,
            get_sidecar_port,
            store_get,
            store_set,
            export_transcript,
            install_mcp_bundle,
            open_privacy_link
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { api: _, .. } | RunEvent::Exit => {
                let state = app_handle.state::<AppState>();
                state.is_shutting_down.store(true, Ordering::Relaxed);
                remove_connection_file(app_handle);

                let child_to_kill = state.sidecar_child.lock().unwrap().take();
                if let Some(child) = child_to_kill {
                    println!("🛑 Killing sidecar on exit...");
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
