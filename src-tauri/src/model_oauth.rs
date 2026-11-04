//! Subscription sign-in (Claude Pro/Max, ChatGPT Plus/Pro): PKCE with a local callback, the same
//! flow and client ids pi-ai uses. The WebView makes the PKCE pair; this side opens the browser,
//! catches the redirect, exchanges and refreshes tokens, and keeps them in their own 0600 file.
use std::collections::BTreeMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

const OAUTH_FILE: &str = "model-oauth.json";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
// Refresh a little early so a long AI run does not start with a token about to lapse.
const REFRESH_MARGIN_MS: u64 = 5 * 60 * 1000;

/// Bumped by every login and by cancel; a waiting login stops once it is no longer the latest.
static LOGIN_GENERATION: AtomicU64 = AtomicU64::new(0);
/// Refresh tokens rotate, so parallel AI runs must not refresh the same account twice.
static STORE_LOCK: LazyLock<tauri::async_runtime::Mutex<()>> =
    LazyLock::new(|| tauri::async_runtime::Mutex::new(()));

struct Vendor {
    authorize_url: &'static str,
    token_url: &'static str,
    client_id: &'static str,
    port: u16,
    path: &'static str,
    scope: &'static str,
    /// Claude's token endpoint takes JSON and wants the PKCE verifier as `state`; OpenAI takes a form.
    claude: bool,
    extra: &'static [(&'static str, &'static str)],
}

fn vendor(provider: &str) -> Result<Vendor, String> {
    match provider {
        "claude-subscription" => Ok(Vendor {
            authorize_url: "https://claude.ai/oauth/authorize",
            token_url: "https://platform.claude.com/v1/oauth/token",
            client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            port: 53692,
            path: "/callback",
            scope: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
            claude: true,
            extra: &[("code", "true")],
        }),
        "chatgpt-subscription" => Ok(Vendor {
            authorize_url: "https://auth.openai.com/oauth/authorize",
            token_url: "https://auth.openai.com/oauth/token",
            client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
            port: 1455,
            path: "/auth/callback",
            scope: "openid profile email offline_access",
            claude: false,
            extra: &[
                ("id_token_add_organizations", "true"),
                ("codex_cli_simplified_flow", "true"),
                ("originator", "pi"),
            ],
        }),
        _ => Err("该服务商不支持账号登录".into()),
    }
}

impl Vendor {
    fn redirect_uri(&self) -> String {
        format!("http://localhost:{}{}", self.port, self.path)
    }
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct Credential {
    access: String,
    refresh: String,
    /// Unix milliseconds.
    expires: u64,
    #[serde(default)]
    email: String,
}

type Store = BTreeMap<String, Credential>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthAccount {
    provider: String,
    email: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_millis() as u64)
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join(OAUTH_FILE))
}

fn read_store(app: &tauri::AppHandle) -> Result<Store, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(Store::new());
    }
    serde_json::from_slice(&std::fs::read(&path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("订阅账号文件无效：{error}"))
}

fn write_store(app: &tauri::AppHandle, store: &Store) -> Result<(), String> {
    super::write_model_store_path(&store_path(app)?, store)
}

fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?).ok()
}

/// The answer's `code` once the browser lands on the callback; anything else is an error to show.
fn parse_callback(request_line: &str, path: &str, state: &str) -> Option<Result<String, String>> {
    let target = request_line.split_whitespace().nth(1)?;
    let url = reqwest::Url::parse(&format!("http://localhost{target}")).ok()?;
    if url.path() != path {
        return None;
    }
    let query: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
    Some(if let Some(error) = query.get("error") {
        Err(format!("授权未完成：{error}"))
    } else if query.get("state").map(String::as_str) != Some(state) {
        Err("授权回调的 state 不匹配".into())
    } else {
        query
            .get("code")
            .cloned()
            .ok_or_else(|| "授权回调缺少 code".into())
    })
}

fn answer(mut stream: TcpStream, status: &str, message: &str) {
    let body =
        format!("<!doctype html><meta charset=\"utf-8\"><title>键设</title><p>{message}</p>");
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn wait_for_code(
    listener: TcpListener,
    path: &str,
    state: &str,
    generation: u64,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    loop {
        if LOGIN_GENERATION.load(Ordering::SeqCst) != generation {
            return Err("已取消登录".into());
        }
        if started.elapsed() > LOGIN_TIMEOUT {
            return Err("登录超时，请重试".into());
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(error) => return Err(error.to_string()),
        };
        // Accepted sockets inherit non-blocking mode on macOS; browsers also open idle preconnects.
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut buffer = [0u8; 8192];
        let read = stream.read(&mut buffer).unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]);
        match parse_callback(request.lines().next().unwrap_or(""), path, state) {
            None => answer(stream, "404 Not Found", "未找到页面"),
            Some(Ok(code)) => {
                answer(stream, "200 OK", "登录成功，可以关闭此页面回到键设。");
                return Ok(code);
            }
            Some(Err(message)) => {
                answer(stream, "400 Bad Request", &message);
                return Err(message);
            }
        }
    }
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url).spawn().map(|_| ())
}

async fn token_request(
    vendor: &Vendor,
    fields: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent("KeySkin")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client
        .post(vendor.token_url)
        .header("Accept", "application/json");
    request = if vendor.claude {
        let body: serde_json::Map<_, _> = fields
            .iter()
            .map(|(key, value)| (key.to_string(), serde_json::Value::from(*value)))
            .collect();
        request
            .header("Content-Type", "application/json")
            .body(serde_json::Value::Object(body).to_string())
    } else {
        // reqwest's form feature is off; Url encodes the pairs the same way.
        let mut encoder =
            reqwest::Url::parse("http://localhost/").map_err(|error| error.to_string())?;
        encoder.query_pairs_mut().extend_pairs(fields);
        request
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(encoder.query().unwrap_or_default().to_string())
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("连接授权服务失败：{}", error.without_url()))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "授权服务返回 HTTP {status}：{}",
            text.chars().take(400).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|_| "授权服务的响应不是有效 JSON".into())
}

/// Turns a token response into a stored credential, keeping what the response leaves out.
fn credential(
    vendor: &Vendor,
    json: &serde_json::Value,
    previous: Option<&Credential>,
) -> Result<Credential, String> {
    let text = |key: &str| {
        json.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    let access = text("access_token").ok_or("授权服务没有返回访问令牌")?;
    let refresh = text("refresh_token")
        .or_else(|| previous.map(|credential| credential.refresh.clone()))
        .ok_or("授权服务没有返回刷新令牌")?;
    let expires_in = json
        .get("expires_in")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(3600);
    let claims = jwt_claims(&access);
    if !vendor.claude
        && claims
            .as_ref()
            .and_then(|claims| claims.pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id"))
            .is_none()
    {
        return Err("令牌里没有 ChatGPT 账号信息".into());
    }
    let email = json
        .pointer("/account/email_address")
        .or_else(|| {
            claims
                .as_ref()?
                .pointer("/https:~1~1api.openai.com~1profile/email")
        })
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .or_else(|| previous.map(|credential| credential.email.clone()))
        .unwrap_or_default();
    Ok(Credential {
        access,
        refresh,
        expires: now_ms() + expires_in * 1000,
        email,
    })
}

#[tauri::command]
pub(crate) fn model_oauth_accounts(app: tauri::AppHandle) -> Result<Vec<OAuthAccount>, String> {
    Ok(read_store(&app)?
        .into_iter()
        .map(|(provider, credential)| OAuthAccount {
            provider,
            email: credential.email,
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn model_oauth_login(
    app: tauri::AppHandle,
    provider: String,
    verifier: String,
    challenge: String,
    state: String,
) -> Result<OAuthAccount, String> {
    let vendor = vendor(&provider)?;
    let state = if vendor.claude {
        verifier.clone()
    } else {
        state
    };
    let generation = LOGIN_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let listener = TcpListener::bind(("127.0.0.1", vendor.port)).map_err(|error| {
        format!(
            "无法使用本机端口 {}（{error}），请关闭其他正在登录的程序后重试",
            vendor.port
        )
    })?;
    let redirect_uri = vendor.redirect_uri();
    let mut params = vec![
        ("response_type", "code"),
        ("client_id", vendor.client_id),
        ("redirect_uri", redirect_uri.as_str()),
        ("scope", vendor.scope),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state.as_str()),
    ];
    params.extend_from_slice(vendor.extra);
    let url = reqwest::Url::parse_with_params(vendor.authorize_url, &params)
        .map_err(|error| error.to_string())?;
    open_browser(url.as_str()).map_err(|error| format!("无法打开浏览器：{error}"))?;
    let path = vendor.path;
    let expected = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_code(listener, path, &expected, generation)
    })
    .await
    .map_err(|error| error.to_string())??;
    let mut fields = vec![
        ("grant_type", "authorization_code"),
        ("client_id", vendor.client_id),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    if vendor.claude {
        fields.push(("state", state.as_str()));
    }
    let credential = credential(&vendor, &token_request(&vendor, &fields).await?, None)?;
    let _guard = STORE_LOCK.lock().await;
    let mut store = read_store(&app)?;
    let email = credential.email.clone();
    store.insert(provider.clone(), credential);
    write_store(&app, &store)?;
    Ok(OAuthAccount { provider, email })
}

#[tauri::command]
pub(crate) fn model_oauth_cancel() {
    LOGIN_GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) async fn model_oauth_logout(
    app: tauri::AppHandle,
    provider: String,
) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().await;
    let mut store = read_store(&app)?;
    if store.remove(&provider).is_some() {
        write_store(&app, &store)?;
    }
    Ok(())
}

/// A usable access token for a signed-in subscription, refreshed and saved when it is about to lapse.
#[tauri::command]
pub(crate) async fn model_oauth_token(
    app: tauri::AppHandle,
    provider: String,
) -> Result<String, String> {
    let vendor = vendor(&provider)?;
    let _guard = STORE_LOCK.lock().await;
    let mut store = read_store(&app)?;
    let current = store
        .get(&provider)
        .ok_or("订阅账号未登录，请在设置 › AI 模型中登录")?;
    if current.expires > now_ms() + REFRESH_MARGIN_MS {
        return Ok(current.access.clone());
    }
    let fields = [
        ("grant_type", "refresh_token"),
        ("client_id", vendor.client_id),
        ("refresh_token", current.refresh.as_str()),
    ];
    let json = token_request(&vendor, &fields)
        .await
        .map_err(|error| format!("订阅登录已失效，请在设置 › AI 模型中重新登录（{error}）"))?;
    let refreshed = credential(&vendor, &json, Some(current))?;
    let access = refreshed.access.clone();
    store.insert(provider, refreshed);
    write_store(&app, &store)?;
    Ok(access)
}

/// Model ids the signed-in account can use right now, from the vendor's own listing.
pub(crate) async fn subscription_models(
    app: tauri::AppHandle,
    provider: String,
) -> Result<Vec<String>, String> {
    let claude = vendor(&provider)?.claude;
    let token = model_oauth_token(app, provider).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    // Same identity headers pi-ai sends when it streams with these tokens.
    let request = if claude {
        client
            .get("https://api.anthropic.com/v1/models?limit=1000")
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-beta", "claude-code-20250219,oauth-2025-04-20")
            .header("x-app", "cli")
            .header("user-agent", "claude-cli/2.1.75")
    } else {
        let account = jwt_claims(&token)
            .and_then(|claims| {
                claims
                    .pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")?
                    .as_str()
                    .map(str::to_string)
            })
            .ok_or("令牌里没有 ChatGPT 账号信息")?;
        // The endpoint rejects requests without client_version; this Codex CLI release lists current models.
        client
            .get("https://chatgpt.com/backend-api/codex/models?client_version=0.159.2")
            .header("chatgpt-account-id", account)
            .header("originator", "pi")
    };
    let response = request
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("连接模型服务失败：{}", error.without_url()))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&bytes)
            .chars()
            .take(400)
            .collect::<String>();
        return Err(format!("模型服务返回 HTTP {status}：{detail}"));
    }
    parse_subscription_models(claude, &bytes)
}

fn parse_subscription_models(claude: bool, bytes: &[u8]) -> Result<Vec<String>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "模型列表响应不是有效 JSON".to_string())?;
    let entries = value
        .get(if claude { "data" } else { "models" })
        .and_then(serde_json::Value::as_array)
        .ok_or("响应中没有模型列表")?;
    // Claude lists newest first; ChatGPT marks models it does not offer in pickers as hidden.
    Ok(entries
        .iter()
        .filter(|entry| {
            !matches!(
                entry.get("visibility").and_then(serde_json::Value::as_str),
                Some("hide" | "hidden")
            )
        })
        .filter_map(|entry| entry.get(if claude { "id" } else { "slug" })?.as_str())
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .map(str::to_string)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{credential, parse_callback, parse_subscription_models, vendor};

    #[test]
    fn subscription_model_lists_keep_order_and_skip_hidden_models() {
        let claude = br#"{"data":[{"id":"claude-opus-5"},{"id":"claude-sonnet-5"}]}"#;
        assert_eq!(
            parse_subscription_models(true, claude).unwrap(),
            ["claude-opus-5", "claude-sonnet-5"]
        );
        let codex = br#"{"models":[{"slug":"gpt-6"},{"slug":"codex-auto-review","visibility":"hide"},{"slug":"gpt-5.5","visibility":"list"}]}"#;
        assert_eq!(
            parse_subscription_models(false, codex).unwrap(),
            ["gpt-6", "gpt-5.5"]
        );
        assert!(parse_subscription_models(false, claude).is_err());
    }

    #[test]
    fn callback_accepts_only_the_expected_path_and_state() {
        let line = "GET /auth/callback?code=abc&state=s1 HTTP/1.1";
        assert_eq!(
            parse_callback(line, "/auth/callback", "s1"),
            Some(Ok("abc".into()))
        );
        assert!(matches!(
            parse_callback(line, "/auth/callback", "s2"),
            Some(Err(_))
        ));
        assert_eq!(
            parse_callback("GET /favicon.ico HTTP/1.1", "/auth/callback", "s1"),
            None
        );
        assert!(matches!(
            parse_callback("GET /callback?error=access_denied HTTP/1.1", "/callback", "s1"),
            Some(Err(message)) if message.contains("access_denied")
        ));
    }

    #[test]
    fn chatgpt_credential_needs_an_account_and_keeps_the_old_refresh_token() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let claims = serde_json::json!({
            "https://api.openai.com/auth": { "chatgpt_account_id": "acct" },
            "https://api.openai.com/profile": { "email": "me@example.com" },
        });
        let token = format!("h.{}.s", URL_SAFE_NO_PAD.encode(claims.to_string()));
        let chatgpt = vendor("chatgpt-subscription").unwrap();
        let first = credential(
            &chatgpt,
            &serde_json::json!({ "access_token": token, "refresh_token": "r1", "expires_in": 60 }),
            None,
        )
        .unwrap();
        assert_eq!(first.email, "me@example.com");
        let next = credential(
            &chatgpt,
            &serde_json::json!({ "access_token": token }),
            Some(&first),
        )
        .unwrap();
        assert_eq!(next.refresh, "r1");
        assert!(credential(
            &chatgpt,
            &serde_json::json!({ "access_token": "plain", "refresh_token": "r" }),
            None
        )
        .is_err());
        let claude = vendor("claude-subscription").unwrap();
        let account = serde_json::json!({ "access_token": "sk-ant-oat01-x", "refresh_token": "r", "expires_in": 60, "account": { "email_address": "c@example.com" } });
        assert_eq!(
            credential(&claude, &account, None).unwrap().email,
            "c@example.com"
        );
    }
}
