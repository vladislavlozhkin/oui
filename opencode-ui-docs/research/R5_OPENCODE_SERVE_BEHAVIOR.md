# R5: opencode serve Runtime Behavior

> How `opencode serve` works at runtime — flags, port detection, health check, auth, shutdown.
> Sources: opencode GitHub (sst/opencode), SDK source, hld Tauri code

---

## 1. CLI Flags

**Command**: `opencode serve [flags]`

**Source**: [packages/opencode/src/cli/cmd/serve.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/cli/cmd/serve.ts)

| Flag            | Type     | Default          | Description                   |
| --------------- | -------- | ---------------- | ----------------------------- |
| `--port`        | number   | `0` (random)     | Port to listen on             |
| `--hostname`    | string   | `127.0.0.1`      | Hostname to bind to           |
| `--mdns`        | boolean  | `false`          | Enable mDNS service discovery |
| `--mdns-domain` | string   | `opencode.local` | Custom mDNS domain            |
| `--cors`        | string[] | `[]`             | Additional CORS origins       |

**Config file override** (`opencode.json`):

```json
{
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0",
    "mdns": true,
    "cors": ["https://example.com"]
  }
}
```

**Precedence**: CLI flags > config file settings

---

## 2. Port Detection

### Stdout Format

```
opencode server listening on http://127.0.0.1:4096
```

**Source**: [serve.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/cli/cmd/serve.ts)

```typescript
console.log(
  `opencode server listening on http://${server.hostname}:${server.port}`,
);
```

### Warning Line

If `OPENCODE_SERVER_PASSWORD` is not set, a warning is printed **before** the listening line:

```
Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.
opencode server listening on http://127.0.0.1:4096
```

### SDK Parsing Example

**Source**: [packages/sdk/js/src/v2/server.ts](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/v2/server.ts)

```typescript
proc.stdout?.on("data", (chunk) => {
  output += chunk.toString();
  const lines = output.split("\n");
  for (const line of lines) {
    if (line.startsWith("opencode server listening")) {
      const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
      if (!match)
        throw new Error(`Failed to parse server url from output: ${line}`);
      resolve(match[1]!);
      return;
    }
  }
});
```

### Comparison with hld

| Aspect         | hld              | opencode                                             |
| -------------- | ---------------- | ---------------------------------------------------- |
| **Format**     | `HTTP_PORT=4096` | `opencode server listening on http://127.0.0.1:4096` |
| **Parsing**    | Split on `=`     | Regex: `/on\s+(https?:\/\/[^\s]+)/`                  |
| **First line** | Always port      | May have warning first                               |

### Rust Implementation Change

```rust
// OLD (hld) — daemon.rs:297
if first_line.starts_with("HTTP_PORT=") {
    let port_str = first_line.trim().replace("HTTP_PORT=", "");
    // ...
}

// NEW (opencode)
// Must loop through lines until "opencode server listening" is found
let re = regex::Regex::new(r"on\s+https?://[^:]+:(\d+)").unwrap();
for line in reader.lines() {
    let line = line?;
    if line.starts_with("opencode server listening") {
        if let Some(caps) = re.captures(&line) {
            let port: u16 = caps[1].parse()?;
            break;
        }
    }
}
```

---

## 3. Health Check

**Endpoint**: `GET /global/health`

**Response**:

```json
{
  "healthy": true,
  "version": "1.0.0"
}
```

### Comparison with hld

| Aspect       | hld                                           | opencode                            |
| ------------ | --------------------------------------------- | ----------------------------------- |
| **Endpoint** | `GET /api/v1/health`                          | `GET /global/health`                |
| **Response** | `{ status: "ok"\|"degraded", dependencies? }` | `{ healthy: true, version: "..." }` |

### Rust Implementation Change

```rust
// OLD
format!("http://localhost:{port}/api/v1/health")

// NEW
format!("http://localhost:{port}/global/health")
```

---

## 4. Authentication

### Environment Variables

| Variable                   | Default            | Description              |
| -------------------------- | ------------------ | ------------------------ |
| `OPENCODE_SERVER_PASSWORD` | (none — unsecured) | HTTP Basic Auth password |
| `OPENCODE_SERVER_USERNAME` | `opencode`         | HTTP Basic Auth username |

**Source**: [server.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/server/server.ts)

```typescript
.use((c, next) => {
  if (c.req.method === "OPTIONS") return next() // CORS preflight
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return next()
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return basicAuth({ username, password })(c, next)
})
```

**For local desktop use**: Authentication is **optional**. The server binds to `127.0.0.1` by default, so only local connections are accepted.

**If needed**, set auth and add header to all requests:

```
Authorization: Basic base64("opencode:your-password")
```

---

## 5. Other Environment Variables

| Variable                  | Purpose                     | Example                                   |
| ------------------------- | --------------------------- | ----------------------------------------- |
| `OPENCODE_CONFIG_CONTENT` | Inline JSON config override | `{"model":"anthropic/claude-sonnet-4-5"}` |
| `OPENCODE_CONFIG`         | Path to custom config file  | `/path/to/config.json`                    |

**SDK spawn pattern** (how the SDK passes config):

```typescript
spawn("opencode", args, {
  env: {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}),
  },
});
```

**For Tauri**: Use `OPENCODE_CONFIG_CONTENT` for runtime config instead of writing files.

---

## 6. Graceful Shutdown

**Known issue**: [GitHub #9859](https://github.com/sst/opencode/issues/9859) — No SIGTERM handler implemented yet. Ghost port bindings on Windows.

**Server has `.stop()` method** internally:

```typescript
server.stop = async (closeActiveConnections?: boolean) => {
  if (shouldPublishMDNS) MDNS.unpublish();
  return originalStop(closeActiveConnections);
};
```

**Recommended strategy** (same as current hld pattern):

1. Send SIGTERM
2. Wait up to 15 seconds
3. Send SIGKILL if still running
4. Clean up process handle

The current `daemon.rs` shutdown code (`stop_daemon()`) at line 409-456 can be reused with minimal changes.

---

## 7. Data Directory

| Platform    | Data Path                             | Config Path           |
| ----------- | ------------------------------------- | --------------------- |
| macOS/Linux | `~/.local/share/opencode/`            | `~/.config/opencode/` |
| Windows     | `%USERPROFILE%\.local\share\opencode` | `%APPDATA%\opencode\` |

**Structure**:

```
~/.local/share/opencode/
├── auth.json              # API keys, OAuth tokens
├── log/                   # Application logs
│   └── 2025-01-09T*.log
└── project/               # Project-specific data
    └── <project-slug>/storage/
```

---

## 8. Working Directory

**Important**: Unlike hld, opencode does **not** need to run from a project root.

The working directory is set **per-request** via:

- Query parameter: `?directory=/path/to/project`
- HTTP header: `x-opencode-directory: /path/to/project`
- Default: `process.cwd()`

**Source**: [server.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/server/server.ts)

```typescript
.use(async (c, next) => {
  const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
  const directory = decodeURIComponent(raw)
  return Instance.provide({ directory, init: InstanceBootstrap, async fn() { return next() } })
})
```

**For Tauri**: Spawn from any directory. Pass project path via `x-opencode-directory` header in API calls.

---

## 9. Comparison with Current hld Spawn

### DaemonInfo → ServerInfo

```rust
// OLD (daemon.rs:13-21)
struct DaemonInfo {
    port: u16,
    pid: u32,
    database_path: String,      // REMOVE - opencode manages its own data
    socket_path: String,        // REMOVE - opencode uses HTTP only
    branch_id: String,          // REMOVE - hld-specific
    is_running: bool,
}

// NEW
struct ServerInfo {
    port: u16,
    pid: u32,
    base_url: String,           // e.g., "http://127.0.0.1:4096"
    is_running: bool,
}
```

### Spawn Command

```rust
// OLD
Command::new(&daemon_path)
    .envs(env_vars)  // HUMANLAYER_* vars
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())

// NEW
Command::new("opencode")  // or bundled path
    .args(["serve", "--port", "0", "--hostname", "127.0.0.1"])
    .env("OPENCODE_CONFIG_CONTENT", config_json)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
```

### Environment Variables

```rust
// OLD
env_vars.push(("HUMANLAYER_DATABASE_PATH", ...));
env_vars.push(("HUMANLAYER_DAEMON_SOCKET", ...));
env_vars.push(("HUMANLAYER_DAEMON_HTTP_PORT", "0"));
env_vars.push(("HUMANLAYER_DAEMON_HTTP_HOST", "localhost"));

// NEW
env_vars.push(("OPENCODE_CONFIG_CONTENT", config_json));
// Optional:
env_vars.push(("OPENCODE_SERVER_PASSWORD", password));
```

### Removable hld-specific code

- Branch-based database paths (`daemon-{branch_id}.db`)
- Socket path management (`daemon.sock`)
- `HUMANLAYER_*` environment variables
- `get_daemon_path()` with dev/prod binary resolution
- Version override logic

---

## Key Takeaways for Migration

### 1. Exact Command

```bash
opencode serve --port 0 --hostname 127.0.0.1
```

### 2. Port Detection

Read stdout line-by-line, look for `"opencode server listening"`, extract URL with regex. **Handle warning line** — it may come before the listening line.

### 3. Health Check

`GET /global/health` (not `/api/v1/health`). Response: `{ "healthy": true }`.

### 4. No Working Directory Requirement

Spawn from anywhere. Set project dir per-request via `x-opencode-directory` header.

### 5. Use `OPENCODE_CONFIG_CONTENT`

Pass runtime config as JSON environment variable instead of writing config files.

### 6. Keep SIGTERM + SIGKILL Pattern

No signal handler in opencode yet. Use same 15-second timeout approach as hld.

### 7. Simplification Opportunity

The opencode version of `server.rs` will be significantly simpler than `daemon.rs`:

- No database path management
- No socket path management
- No branch-based isolation
- No dev/prod binary resolution (just find `opencode` in PATH)

---

## Migration Checklist

- [ ] Rename `DaemonInfo` → `ServerInfo` (drop database_path, socket_path, branch_id)
- [ ] Update spawn command: `opencode serve --port 0 --hostname 127.0.0.1`
- [ ] Update stdout parsing: loop until `"opencode server listening"`, regex for port
- [ ] Update health check: `GET /global/health`
- [ ] Remove HUMANLAYER\_\* env vars, add OPENCODE_CONFIG_CONTENT
- [ ] Keep SIGTERM → SIGKILL shutdown (15s timeout)
- [ ] Remove branch-based database/socket paths
- [ ] Find opencode binary in PATH (or bundle)
- [ ] Update Tauri commands: `start_daemon` → `start_server`, etc.
- [ ] Update frontend URL resolution for new health endpoint
