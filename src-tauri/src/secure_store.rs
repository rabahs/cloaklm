//! Encrypted app data: settings (including API keys), chats, projects and their
//! redaction maps, which hold the real names and numbers.
//!
//! Replaces tauri-plugin-store, which kept everything in a plaintext, world-
//! readable file and let the webview load or save a store at any path.
//! The file is AES-256-GCM encrypted with a key kept in the OS keychain (macOS
//! Keychain, Windows Credential Manager), written owner-only and atomically.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use serde_json::{Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAGIC: &[u8; 4] = b"CLK1";
const STORE_FILE: &str = "cloaklm_store.enc";
const LEGACY_FILE: &str = "cloaklm_store.bin";
const KEYCHAIN_SERVICE: &str = "com.rabahshihab.cloaklm";
const KEYCHAIN_ACCOUNT: &str = "store-key";

pub struct SecureStore {
    path: PathBuf,
    key: [u8; 32],
    data: Mutex<Map<String, Value>>,
}

impl SecureStore {
    /// Opens the store in `dir`, migrating the old plaintext store if present.
    pub fn open(dir: &Path, key: [u8; 32]) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(STORE_FILE);
        let legacy = dir.join(LEGACY_FILE);
        let mut data = Map::new();

        if path.exists() {
            match std::fs::read(&path).ok().and_then(|bytes| decrypt(&key, &bytes)) {
                Some(plain) => data = serde_json::from_slice(&plain).unwrap_or_default(),
                None => {
                    // Wrong key (keychain item removed) or a damaged file: keep it
                    // aside rather than overwrite it, and start empty.
                    let aside = path.with_extension(format!("unreadable-{}", std::process::id()));
                    eprintln!("Store could not be decrypted; moved aside to {}", aside.display());
                    std::fs::rename(&path, aside)?;
                }
            }
        } else if legacy.exists() {
            if let Ok(text) = std::fs::read(&legacy) {
                data = serde_json::from_slice(&text).unwrap_or_default();
            }
        }

        let store = SecureStore { path, key, data: Mutex::new(data) };
        if legacy.exists() {
            store.flush()?;
            shred(&legacy);
        }
        Ok(store)
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.data.lock().unwrap().get(key).cloned()
    }

    pub fn set(&self, key: &str, value: Value) -> std::io::Result<()> {
        self.data.lock().unwrap().insert(key.to_string(), value);
        self.flush()
    }

    fn flush(&self) -> std::io::Result<()> {
        let plain = serde_json::to_vec(&*self.data.lock().unwrap())?;
        write_private_file(&self.path, &encrypt(&self.key, &plain))
    }
}

fn encrypt(key: &[u8; 32], plain: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce).expect("OS random number generator unavailable");
    let sealed = cipher.encrypt(Nonce::from_slice(&nonce), plain).expect("AES-GCM encryption failed");
    [MAGIC.as_slice(), &nonce, &sealed].concat()
}

fn decrypt(key: &[u8; 32], data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 16 || &data[..4] != MAGIC {
        return None;
    }
    let cipher = Aes256Gcm::new(key.into());
    cipher.decrypt(Nonce::from_slice(&data[4..16]), &data[16..]).ok()
}

/// Overwrites the old plaintext store before deleting it.
fn shred(path: &Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open(path) {
            let _ = f.write_all(&vec![0u8; meta.len() as usize]);
            let _ = f.sync_all();
        }
    }
    let _ = std::fs::remove_file(path);
}

/// Creates a fresh owner-only file and renames it over `path`, so the contents
/// are never readable by other users and readers never see a half-written file.
pub fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts.open(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(&tmp, path)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn unhex(text: &str) -> Option<[u8; 32]> {
    let text = text.trim();
    if text.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in text.as_bytes().chunks(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
    }
    Some(out)
}

fn new_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).expect("OS random number generator unavailable");
    key
}

/// The key for this build. Release builds keep it in the keychain and adopt a key
/// file left by a development build (then delete the file). Development builds use
/// the key file, falling back to the keychain when a release build created the store.
pub fn store_key(dir: &Path, release: bool) -> std::io::Result<[u8; 32]> {
    store_key_for(dir, release, KEYCHAIN_ACCOUNT)
}

fn store_key_for(dir: &Path, release: bool, account: &str) -> std::io::Result<[u8; 32]> {
    let key_file = dir.join("store.key");
    let file_key_value = std::fs::read_to_string(&key_file).ok().and_then(|t| unhex(&t));
    if release {
        if let Some(key) = file_key_value {
            if keyring::Entry::new(KEYCHAIN_SERVICE, account)
                .and_then(|e| e.set_password(&hex(&key)))
                .is_ok()
            {
                shred(&key_file);
            }
            return Ok(key);
        }
        return keychain_key_for(account).or_else(|e| {
            eprintln!("Keychain unavailable ({}); using a key file", e);
            file_key(dir)
        });
    }
    if let Some(key) = file_key_value {
        return Ok(key);
    }
    if dir.join(STORE_FILE).exists() {
        if let Ok(key) = keychain_key_for(account) {
            return Ok(key);
        }
    }
    file_key(dir)
}

/// The store key from the OS keychain, created on first run.
fn keychain_key_for(account: &str) -> keyring::Result<[u8; 32]> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account)?;
    match entry.get_password() {
        Ok(text) => unhex(&text).ok_or(keyring::Error::Invalid("store-key".into(), "not 32 hex bytes".into())),
        Err(keyring::Error::NoEntry) => {
            let key = new_key();
            entry.set_password(&hex(&key))?;
            Ok(key)
        }
        Err(e) => Err(e),
    }
}

/// A key file next to the store (owner-only). Used in development builds, whose
/// binary changes on every rebuild and would make the keychain prompt each time,
/// and as a last resort where no keychain is available.
pub fn file_key(dir: &Path) -> std::io::Result<[u8; 32]> {
    let path = dir.join("store.key");
    if let Some(key) = std::fs::read_to_string(&path).ok().and_then(|t| unhex(&t)) {
        return Ok(key);
    }
    std::fs::create_dir_all(dir)?;
    let key = new_key();
    write_private_file(&path, hex(&key).as_bytes())?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cloaklm-store-test-{}-{}", name, hex(&new_key()[..4])));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trip_and_ciphertext_hides_values() {
        let dir = temp_dir("roundtrip");
        let key = new_key();
        let store = SecureStore::open(&dir, key).unwrap();
        store.set("settings", json!({"apiKeys": {"claude": "sk-ant-secret"}})).unwrap();
        let raw = std::fs::read(dir.join(STORE_FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("sk-ant-secret"));
        let reopened = SecureStore::open(&dir, key).unwrap();
        assert_eq!(reopened.get("settings").unwrap()["apiKeys"]["claude"], "sk-ant-secret");
    }

    #[cfg(unix)]
    #[test]
    fn files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perms");
        SecureStore::open(&dir, new_key()).unwrap().set("x", json!(1)).unwrap();
        let mode = std::fs::metadata(dir.join(STORE_FILE)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        file_key(&dir).unwrap();
        let mode = std::fs::metadata(dir.join("store.key")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn tampering_or_wrong_key_is_detected_and_kept_aside() {
        let dir = temp_dir("tamper");
        let store = SecureStore::open(&dir, new_key()).unwrap();
        store.set("projects", json!(["p"])).unwrap();
        let reopened = SecureStore::open(&dir, new_key()).unwrap();
        assert!(reopened.get("projects").is_none());
        let aside = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains("unreadable"));
        assert!(aside, "unreadable store should be moved aside, not overwritten");
    }

    #[test]
    fn migrates_and_removes_legacy_plaintext_store() {
        let dir = temp_dir("legacy");
        std::fs::write(dir.join(LEGACY_FILE), r#"{"projects":[{"id":"1","name":"Taxes"}]}"#).unwrap();
        let key = new_key();
        SecureStore::open(&dir, key).unwrap();
        assert!(!dir.join(LEGACY_FILE).exists());
        assert_eq!(SecureStore::open(&dir, key).unwrap().get("projects").unwrap()[0]["name"], "Taxes");
    }

    #[test]
    fn file_key_is_stable() {
        let dir = temp_dir("filekey");
        assert_eq!(file_key(&dir).unwrap(), file_key(&dir).unwrap());
    }

    // Touches the real OS keychain; run with `cargo test -- --ignored keychain`.
    #[test]
    #[ignore]
    fn keychain_key_is_created_once_and_reused() {
        let account = "store-key-test";
        let first = keychain_key_for(account).unwrap();
        assert_eq!(first, keychain_key_for(account).unwrap());
        keyring::Entry::new(KEYCHAIN_SERVICE, account).unwrap().delete_credential().unwrap();
    }

    // Dev build writes the store with a key file; the release build must still read
    // it, and then a dev build again. Real keychain; run with `--ignored keychain`.
    #[test]
    #[ignore]
    fn keychain_handover_between_dev_and_release_builds() {
        let account = "store-key-handover-test";
        let dir = temp_dir("handover");
        let dev_key = store_key_for(&dir, false, account).unwrap();
        SecureStore::open(&dir, dev_key).unwrap().set("projects", json!(["p"])).unwrap();

        let release_key = store_key_for(&dir, true, account).unwrap();
        assert_eq!(release_key, dev_key);
        assert!(!dir.join("store.key").exists(), "key file adopted into the keychain");
        assert_eq!(SecureStore::open(&dir, release_key).unwrap().get("projects").unwrap()[0], "p");

        assert_eq!(store_key_for(&dir, false, account).unwrap(), dev_key, "dev build finds it in the keychain");
        keyring::Entry::new(KEYCHAIN_SERVICE, account).unwrap().delete_credential().unwrap();
    }
}
