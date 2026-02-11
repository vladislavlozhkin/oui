use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::env;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub port: u16,
    pub pid: u32,
    pub base_url: String, // e.g., "http://127.0.0.1:4096"
    pub is_running: bool,
}

#[derive(Clone)]
pub struct ServerManager {
    process: Arc<Mutex<Option<Child>>>,
    info: Arc<Mutex<Option<ServerInfo>>>,
}

impl ServerManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            info: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start_server(
        &self,
        app_handle: &AppHandle,
        is_dev: bool,
        config_content: Option<String>,
    ) -> Result<ServerInfo, String> {
        // Check if already running
        {
            let process = self.process.lock().unwrap();
            if process.is_some() {
                if let Some(info) = self.info.lock().unwrap().as_ref() {
                    return Ok(info.clone());
                }
            }
        }

        // Check if we should skip auto-launch
        if env::var("OPENCODE_WUI_AUTOLAUNCH_SERVER")
            .map(|v| v.trim().to_ascii_lowercase())
            == Ok("false".to_string())
        {
            // Don't auto-launch server, expect it to be managed externally
            log::info!("[Tauri] Auto-launch disabled via OPENCODE_WUI_AUTOLAUNCH_SERVER=false");

            // Still need to return server info for external server
            if let Ok(port_str) = env::var("OPENCODE_SERVER_PORT") {
                if let Ok(port) = port_str.parse::<u16>() {
                    let base_url = format!("http://127.0.0.1:{port}");

                    let info = ServerInfo {
                        port,
                        pid: 0, // Unknown PID for pre-existing server
                        base_url,
                        is_running: true,
                    };
                    *self.info.lock().unwrap() = Some(info.clone());
                    return Ok(info);
                }
            }
            return Err(
                "OPENCODE_WUI_AUTOLAUNCH_SERVER=false but no OPENCODE_SERVER_PORT set".to_string(),
            );
        }

        // Check if server is already running on a specific port
        if let Ok(port_str) = env::var("OPENCODE_SERVER_PORT") {
            if let Ok(port) = port_str.parse::<u16>() {
                // Try to connect to existing server
                if check_server_health(port).await.is_ok() {
                    let info = ServerInfo {
                        port,
                        pid: 0, // Unknown PID for external server
                        base_url: format!("http://127.0.0.1:{port}"),
                        is_running: true,
                    };
                    *self.info.lock().unwrap() = Some(info.clone());
                    return Ok(info);
                }
            }
        }

        // Get server binary path
        let server_path = get_server_path(app_handle, is_dev)?;

        // Build environment
        let mut env_vars: Vec<(String, String)> = env::vars().collect();

        // Pass config via environment variable if provided
        if let Some(config) = config_content {
            env_vars.push(("OPENCODE_CONFIG_CONTENT".to_string(), config));
        }

        // Remove any HUMANLAYER_* env vars that might have leaked
        env_vars.retain(|(k, _)| !k.starts_with("HUMANLAYER_"));

        // Build command: opencode serve --port 0 --hostname 127.0.0.1
        let mut cmd = Command::new(&server_path);
        cmd.arg("serve")
            .arg("--port")
            .arg("0")
            .arg("--hostname")
            .arg("127.0.0.1");

        // Log the full command being executed for debugging
        log::info!("[Tauri] Executing server at path: {server_path:?}");
        log::info!("[Tauri] Server command: opencode serve --port 0 --hostname 127.0.0.1");

        // Log current PATH that will be inherited by server
        if let Ok(path) = std::env::var("PATH") {
            log::info!("[Tauri] PATH being passed to server: {path}");
        }

        // Always capture stderr for better debugging
        cmd.envs(env_vars)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start server: {e}"))?;

        // Get the PID before we do anything else
        let pid = child.id();
        log::info!("[Tauri] Server spawned with PID: {pid}");

        // Spawn a task to read stderr for debugging
        if let Some(stderr) = child.stderr.take() {
            let is_prod = !is_dev;
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(line) => {
                            if is_prod {
                                if line.contains("ERROR")
                                    || line.contains("error")
                                    || line.contains("Error")
                                {
                                    log::error!("[Server] {line}");
                                } else if line.contains("WARN")
                                    || line.contains("warn")
                                    || line.contains("Warning")
                                {
                                    log::warn!("[Server] {line}");
                                } else {
                                    log::info!("[Server] {line}");
                                }
                            } else {
                                let level = extract_log_level(&line);
                                let cleaned_line = remove_timestamp(&line);

                                match level {
                                    LogLevel::Error => {
                                        log::error!("[Server] {cleaned_line}")
                                    }
                                    LogLevel::Warn => {
                                        log::warn!("[Server] {cleaned_line}")
                                    }
                                    LogLevel::Info => {
                                        log::info!("[Server] {cleaned_line}")
                                    }
                                    LogLevel::Debug => {
                                        log::debug!("[Server] {cleaned_line}")
                                    }
                                    LogLevel::Trace => {
                                        log::trace!("[Server] {cleaned_line}")
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("[Tauri] Error reading server stderr: {e}");
                            break;
                        }
                    }
                }
                log::info!("[Tauri] Server stderr reader finished");
            });
        }

        // Parse stdout to get the actual port
        // NEW: opencode outputs "opencode server listening on http://127.0.0.1:PORT"
        // May have warning line before: "Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured."
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture server stdout")?;

        let reader = BufReader::new(stdout);

        // Use regex to extract port from listening message
        let re = Regex::new(r"on\s+https?://[^:]+:(\d+)")
            .map_err(|e| format!("Failed to compile regex: {e}"))?;

        let mut actual_port: Option<u16> = None;
        let mut lines_read = Vec::new();

        log::info!("[Tauri] Waiting for server to report listening address on stdout...");

        // Read lines until we find the listening message or timeout
        let reader_lines = reader.lines();
        for line_result in reader_lines {
            let line = line_result.map_err(|e| format!("Failed to read stdout: {e}"))?;
            log::info!("[Tauri] Server stdout: {line}");
            lines_read.push(line.clone());

            // Check for the listening message
            if line.contains("opencode server listening") || line.contains("listening on") {
                if let Some(caps) = re.captures(&line) {
                    actual_port = Some(
                        caps[1]
                            .parse::<u16>()
                            .map_err(|e| format!("Failed to parse port: {e}"))?,
                    );
                    log::info!("[Tauri] Parsed port {} from listening message", actual_port.unwrap());
                    break;
                }
            }

            // Check for common startup errors
            if line.contains("error") || line.contains("Error") || line.contains("failed") {
                log::error!("[Tauri] Server startup error detected: {line}");
            }

            // Safety limit - don't read forever
            if lines_read.len() > 50 {
                log::error!("[Tauri] Too many lines read without finding port");
                break;
            }
        }

        let port = actual_port.ok_or_else(|| {
            format!(
                "Server failed to report port. Lines read: {:?}",
                lines_read
            )
        })?;

        log::info!("[Tauri] Got port {port} from server stdout");

        // Spawn a task to keep reading stdout to prevent SIGPIPE
        tokio::spawn(async move {
            // Note: reader has been consumed, no need to keep reading
            log::debug!("[Tauri] Stdout reader task finished");
        });

        // Check if process is still alive after reading port
        match child.try_wait() {
            Ok(None) => log::info!("[Tauri] Server process still running after port read"),
            Ok(Some(status)) => {
                return Err(format!(
                    "Server process exited immediately after starting! Status: {status:?}"
                ));
            }
            Err(e) => log::error!("[Tauri] Error checking server status: {e}"),
        }

        let base_url = format!("http://127.0.0.1:{port}");
        let server_info = ServerInfo {
            port,
            pid,
            base_url,
            is_running: true,
        };

        // Store the process and info before awaiting
        {
            let mut process = self.process.lock().unwrap();
            *process = Some(child);
        }
        *self.info.lock().unwrap() = Some(server_info.clone());

        // Wait for server to be ready
        log::info!("[Tauri] Waiting for server to be ready on port {port}");
        wait_for_server(port).await?;
        log::info!("[Tauri] Server is ready and responding to health checks");

        // Spawn a task to monitor the server process
        let process_arc = self.process.clone();
        let port_for_monitor = port;
        tokio::spawn(async move {
            let mut last_check = std::time::Instant::now();
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

                let mut process_guard = process_arc.lock().unwrap();
                if let Some(child) = process_guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            log::error!(
                                "[Tauri] Server process exited unexpectedly! Port: {port_for_monitor}, Exit status: {status:?}, Time since last check: {:?}",
                                last_check.elapsed()
                            );
                            *process_guard = None;
                            break;
                        }
                        Ok(None) => {
                            last_check = std::time::Instant::now();
                        }
                        Err(e) => {
                            log::error!("[Tauri] Error checking server process status: {e}");
                            break;
                        }
                    }
                } else {
                    break;
                }
            }
        });

        Ok(server_info)
    }

    pub fn stop_server(&self) -> Result<(), String> {
        let mut process = self.process.lock().unwrap();

        if let Some(mut child) = process.take() {
            let pid = child.id();

            // Try SIGTERM first (graceful shutdown)
            signal::kill(Pid::from_raw(pid as i32), Signal::SIGTERM)
                .map_err(|e| format!("Failed to send SIGTERM to server: {e}"))?;

            log::info!("[Tauri] Sent SIGTERM to server process (PID: {pid})");

            // Wait for process to exit gracefully (with timeout)
            let start = std::time::Instant::now();
            let timeout = std::time::Duration::from_secs(15);

            loop {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        log::info!("[Tauri] Server process exited gracefully after SIGTERM");
                        break;
                    }
                    Ok(None) => {
                        if start.elapsed() > timeout {
                            // Force kill if it doesn't exit within timeout
                            log::warn!("[Tauri] Server didn't exit gracefully, sending SIGKILL");
                            child
                                .kill()
                                .map_err(|e| format!("Failed to kill server: {e}"))?;
                            let _ = child.wait();
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(e) => {
                        return Err(format!("Failed to check server status: {e}"));
                    }
                }
            }

            // Update info to mark server as not running
            if let Some(info) = self.info.lock().unwrap().as_mut() {
                info.is_running = false;
            }
        }

        Ok(())
    }

    pub fn get_info(&self) -> Option<ServerInfo> {
        self.info.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        let mut process = self.process.lock().unwrap();
        if let Some(child) = process.as_mut() {
            match child.try_wait() {
                Ok(None) => true,  // Still running
                _ => false,        // Exited or error
            }
        } else {
            false
        }
    }
}

fn get_server_path(app_handle: &AppHandle, is_dev: bool) -> Result<PathBuf, String> {
    if is_dev {
        // In dev mode, find opencode in PATH
        find_opencode_in_path()
            .map_err(|_| "opencode not found in PATH. Install it with: curl -fsSL https://opencode.ai/install | bash".to_string())
    } else {
        // Production: use bundled binary
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {e}"))?;

        Ok(resource_dir.join("bin").join("opencode"))
    }
}

fn find_opencode_in_path() -> Result<PathBuf, String> {
    // Use `which` command to find opencode in PATH
    let output = Command::new("which")
        .arg("opencode")
        .output()
        .map_err(|e| format!("Failed to run 'which opencode': {e}"))?;

    if output.status.success() {
        let path_str = String::from_utf8(output.stdout)
            .map_err(|e| format!("Invalid UTF-8 in path: {e}"))?
            .trim()
            .to_string();

        if path_str.is_empty() {
            Err("opencode not found in PATH".to_string())
        } else {
            Ok(PathBuf::from(path_str))
        }
    } else {
        Err("opencode not found in PATH".to_string())
    }
}

async fn check_server_health(port: u16) -> Result<(), String> {
    let client = reqwest::Client::new();
    match client
        .get(format!("http://localhost:{port}/global/health"))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => Ok(()),
        Ok(_) => Err("Server health check failed".to_string()),
        Err(e) => Err(format!("Failed to connect to server: {e}")),
    }
}

async fn wait_for_server(port: u16) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(10);

    while start.elapsed() < timeout {
        if check_server_health(port).await.is_ok() {
            return Ok(());
        }

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    Err("Server failed to start within 10 seconds".to_string())
}

#[derive(Debug)]
enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

fn extract_log_level(line: &str) -> LogLevel {
    if line.contains(" ERROR ") || line.contains("ERROR[") {
        LogLevel::Error
    } else if line.contains(" WARN ") || line.contains("WARN[") {
        LogLevel::Warn
    } else if line.contains(" INFO ") || line.contains("INFO[") {
        LogLevel::Info
    } else if line.contains(" DEBUG ") || line.contains("DEBUG[") {
        LogLevel::Debug
    } else if line.contains(" TRACE ") || line.contains("TRACE[") {
        LogLevel::Trace
    } else {
        LogLevel::Info
    }
}

fn remove_timestamp(line: &str) -> &str {
    if let Some(idx) = line.find(" INFO ") {
        &line[idx + 6..]
    } else if let Some(idx) = line.find(" ERROR ") {
        &line[idx + 7..]
    } else if let Some(idx) = line.find(" WARN ") {
        &line[idx + 6..]
    } else if let Some(idx) = line.find(" DEBUG ") {
        &line[idx + 7..]
    } else if let Some(idx) = line.find(" TRACE ") {
        &line[idx + 7..]
    } else {
        line
    }
}
