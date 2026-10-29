use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::window::{Effect, EffectsBuilder};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

struct OpenedFiles(Mutex<Vec<String>>);
struct ClientLog(Mutex<()>);

const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SOURCE_BYTES: usize = 256 * 1024 * 1024;
const MAX_SOURCE_FILES: usize = 4096;
const SOURCE_MARKER: &str = ".keyskin-source";
const SOURCE_MANIFEST: &str = ".keyskin-files.json";
// 与前端最近皮肤上限 recentFilesLimit 保持一致，每条最近记录都能找回自己的源码目录。
const SOURCE_LIMIT: usize = 9;
const RELEASES_URL: &str = "https://github.com/rekazer0/keyskin/releases";
const CLIENT_LOG_FILE: &str = "client.jsonl";
const CLIENT_LOG_PREVIOUS_FILE: &str = "client.previous.jsonl";
const MAX_CLIENT_LOG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_CLIENT_LOG_BATCH_BYTES: usize = 256 * 1024;
const MODEL_CONFIG_FILE: &str = "model-config.json";
const MAX_MODEL_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_MODEL_CHAT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfiguration {
    provider: String,
    protocol: String,
    api_url: String,
    model: String,
    api_key: String,
    /// "image" marks the image-generation model; empty for chat models.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    kind: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfigurationState {
    configuration: Option<ModelConfiguration>,
    configurations: Vec<ModelConfiguration>,
    path: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct ModelConfigurationStore {
    #[serde(flatten)]
    configuration: ModelConfiguration,
    #[serde(default)]
    configurations: Vec<ModelConfiguration>,
}

fn read_model_profiles(path: &Path) -> Result<Vec<ModelConfiguration>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let store: ModelConfigurationStore =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let profiles = if store.configurations.is_empty() {
        vec![store.configuration]
    } else {
        store.configurations
    };
    for profile in &profiles {
        validate_model_configuration(profile)?;
    }
    Ok(profiles)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelConnectionResult {
    message: String,
    model_count: usize,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelHttpRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ModelHttpEvent {
    Headers {
        status: u16,
        headers: Vec<(String, String)>,
    },
    Chunk {
        body: Vec<u8>,
    },
    // Channel messages are ordered among themselves but not against the command's return.
    End,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientLogFile {
    name: String,
    data: Vec<u8>,
}

fn append_client_log_path(directory: &Path, lines: &str, max_bytes: u64) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let current = directory.join(CLIENT_LOG_FILE);
    let previous = directory.join(CLIENT_LOG_PREVIOUS_FILE);
    let incoming = lines.len() as u64 + u64::from(!lines.ends_with('\n'));
    if fs::metadata(&current).map(|value| value.len()).unwrap_or(0) + incoming > max_bytes {
        if previous.exists() {
            fs::remove_file(&previous).map_err(|error| error.to_string())?;
        }
        if current.exists() {
            fs::rename(&current, &previous).map_err(|error| error.to_string())?;
        }
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(current)
        .map_err(|error| error.to_string())?;
    file.write_all(lines.as_bytes())
        .map_err(|error| error.to_string())?;
    if !lines.ends_with('\n') {
        file.write_all(b"\n").map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_client_log_path(directory: &Path) -> Result<Vec<ClientLogFile>, String> {
    [CLIENT_LOG_PREVIOUS_FILE, CLIENT_LOG_FILE]
        .into_iter()
        .filter_map(|name| {
            let path = directory.join(name);
            path.is_file().then(|| {
                fs::read(path)
                    .map(|data| ClientLogFile {
                        name: name.into(),
                        data,
                    })
                    .map_err(|error| error.to_string())
            })
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceFile {
    path: String,
    data: Vec<u8>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EncodedSourceFile {
    path: String,
    data: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceChange {
    path: String,
    data: Option<Vec<u8>>,
    directory: bool,
}

fn safe_source_path(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn source_target(root: &Path, path: &str) -> Result<PathBuf, String> {
    if !safe_source_path(path) {
        return Err(format!("皮肤源码包含不安全路径：{path}"));
    }
    let mut target = root.to_path_buf();
    for part in Path::new(path).components() {
        let Component::Normal(name) = part else {
            unreachable!()
        };
        target.push(name);
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("皮肤源码路径包含符号链接：{path}"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(target)
}

fn canonical_event_path(path: PathBuf) -> PathBuf {
    fs::canonicalize(&path).unwrap_or_else(|_| {
        let Some(parent) = path.parent() else {
            return path.clone();
        };
        let Some(name) = path.file_name() else {
            return path.clone();
        };
        fs::canonicalize(parent)
            .map(|canonical| canonical.join(name))
            .unwrap_or(path)
    })
}

fn source_root(app: &tauri::AppHandle, path: Option<String>) -> Result<PathBuf, String> {
    let directory = match path.filter(|value| !value.trim().is_empty()) {
        Some(value) => PathBuf::from(value),
        None => {
            #[cfg(target_os = "android")]
            return Err("请先选择用户可访问的源码保存目录".into());
            #[cfg(not(target_os = "android"))]
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("skin-sources")
        }
    };
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    if !directory.is_dir() {
        return Err("源码保存路径不是文件夹".into());
    }
    fs::canonicalize(directory).map_err(|error| error.to_string())
}

fn source_paths(files: &[SourceFile]) -> Result<Vec<String>, String> {
    if files.len() > MAX_SOURCE_FILES {
        return Err(format!("皮肤源码文件超过 {MAX_SOURCE_FILES} 个"));
    }
    let mut total = 0usize;
    let mut paths = Vec::with_capacity(files.len());
    for file in files {
        if !safe_source_path(&file.path) {
            return Err(format!("皮肤源码包含不安全路径：{}", file.path));
        }
        total = total
            .checked_add(file.data.len())
            .ok_or_else(|| "皮肤源码过大".to_string())?;
        if total > MAX_SOURCE_BYTES {
            return Err("皮肤源码超过 256 MB".into());
        }
        if paths.contains(&file.path) {
            return Err(format!("皮肤源码包含重复路径：{}", file.path));
        }
        paths.push(file.path.clone());
    }
    Ok(paths)
}

// Binary resources must not cross IPC as one JSON number per byte.
fn encode_source_files(files: Vec<SourceFile>) -> Vec<EncodedSourceFile> {
    files
        .into_iter()
        .map(|file| EncodedSourceFile {
            path: file.path,
            data: BASE64_STANDARD.encode(file.data),
        })
        .collect()
}

fn decode_source_files(files: Vec<EncodedSourceFile>) -> Result<Vec<SourceFile>, String> {
    let mut output = Vec::with_capacity(files.len());
    for file in files {
        let data = BASE64_STANDARD
            .decode(&file.data)
            .map_err(|_| format!("皮肤源码数据无效：{}", file.path))?;
        output.push(SourceFile {
            path: file.path,
            data,
        });
    }
    source_paths(&output)?;
    Ok(output)
}

fn remove_empty_parents(mut path: PathBuf, root: &Path) -> Result<(), String> {
    while path != root {
        if fs::read_dir(&path)
            .map_err(|error| error.to_string())?
            .next()
            .is_some()
        {
            break;
        }
        fs::remove_dir(&path).map_err(|error| error.to_string())?;
        let Some(parent) = path.parent() else { break };
        path = parent.to_path_buf();
    }
    Ok(())
}

fn write_source_files(directory: &Path, files: &[SourceFile]) -> Result<(), String> {
    let paths = source_paths(files)?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let manifest = source_target(directory, SOURCE_MANIFEST)?;
    let previous: Vec<String> = fs::read(&manifest)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default();
    for path in previous.iter().filter(|path| !paths.contains(path)) {
        if !safe_source_path(path) {
            continue;
        }
        let target = source_target(directory, path)?;
        if target.is_file() {
            fs::remove_file(&target).map_err(|error| error.to_string())?;
            if let Some(parent) = target.parent() {
                remove_empty_parents(parent.to_path_buf(), directory)?;
            }
        }
    }
    for file in files {
        let target = source_target(directory, &file.path)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(target, &file.data).map_err(|error| error.to_string())?;
    }
    fs::write(
        manifest,
        serde_json::to_vec(&paths).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn read_source_files(directory: &Path) -> Result<Vec<SourceFile>, String> {
    fn visit(
        root: &Path,
        directory: &Path,
        output: &mut Vec<SourceFile>,
        total: &mut usize,
    ) -> Result<(), String> {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let name = entry.file_name();
            if directory == root
                && (name == SOURCE_MARKER || name == SOURCE_MANIFEST || name == ".DS_Store")
            {
                continue;
            }
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                visit(root, &path, output, total)?;
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if output.len() >= MAX_SOURCE_FILES {
                return Err(format!("皮肤源码文件超过 {MAX_SOURCE_FILES} 个"));
            }
            let data = fs::read(&path).map_err(|error| error.to_string())?;
            *total = total
                .checked_add(data.len())
                .ok_or_else(|| "皮肤源码过大".to_string())?;
            if *total > MAX_SOURCE_BYTES {
                return Err("皮肤源码超过 256 MB".into());
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            output.push(SourceFile {
                path: relative,
                data,
            });
        }
        Ok(())
    }

    if !directory.is_dir() {
        return Err("选择的路径不是文件夹".into());
    }
    let mut files = Vec::new();
    let mut total = 0;
    visit(directory, directory, &mut files, &mut total)?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn workspace_name(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("skin");
    let cleaned: String = stem
        .chars()
        .map(|value| {
            if value.is_alphanumeric() || value == '-' || value == '_' {
                value
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('-');
    if cleaned.is_empty() {
        "skin".into()
    } else {
        cleaned.chars().take(48).collect()
    }
}

fn prune_source_workspaces(root: &Path) -> Result<(), String> {
    let mut workspaces = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir() && entry.path().join(SOURCE_MARKER).is_file())
        .collect::<Vec<_>>();
    // 按标记文件时间排序：打开源码目录时会刷新它，最近用过的目录不会先被删。
    workspaces.sort_by_key(|entry| {
        fs::metadata(entry.path().join(SOURCE_MARKER))
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH)
    });
    let remove_count = workspaces.len().saturating_sub(SOURCE_LIMIT);
    for entry in workspaces.into_iter().take(remove_count) {
        fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn prepare_source_directory(app: tauri::AppHandle, path: Option<String>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    if let Some(uri) = path
        .as_deref()
        .filter(|value| value.starts_with("content://"))
    {
        return Ok(uri.to_string());
    }
    let directory = source_root(&app, path)?;
    app.fs_scope()
        .allow_directory(&directory, true)
        .map_err(|error| error.to_string())?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
async fn create_source_workspace(
    app: tauri::AppHandle,
    directory: Option<String>,
    name: String,
    files: Vec<EncodedSourceFile>,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    if let Some(uri) = directory
        .as_deref()
        .filter(|value| value.starts_with("content://"))
    {
        return tauri_plugin_native_share::create_source_workspace(
            &app,
            uri.to_string(),
            name,
            serde_json::to_value(files).map_err(|error| error.to_string())?,
        )
        .await;
    }
    let files = decode_source_files(files)?;
    let uses_builtin_directory = directory
        .as_ref()
        .is_none_or(|value| value.trim().is_empty());
    let root = source_root(&app, directory)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let base = format!("{timestamp}-{}", workspace_name(&name));
    let mut workspace = root.join(&base);
    let mut suffix = 2;
    while workspace.exists() {
        workspace = root.join(format!("{base}-{suffix}"));
        suffix += 1;
    }
    fs::create_dir(&workspace).map_err(|error| error.to_string())?;
    let result = (|| {
        fs::write(
            workspace.join(SOURCE_MARKER),
            b"KeySkin source workspace\n",
        )
        .map_err(|error| error.to_string())?;
        write_source_files(&workspace, &files)?;
        if uses_builtin_directory {
            prune_source_workspaces(&root)?;
        }
        app.fs_scope()
            .allow_directory(&workspace, true)
            .map_err(|error| error.to_string())?;
        Ok(workspace.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&workspace);
    }
    result
}

#[tauri::command]
async fn open_source_workspace(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<EncodedSourceFile>, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let value = tauri_plugin_native_share::read_source_workspace(&app, path).await?;
        let files: Vec<SourceFile> =
            serde_json::from_value(value).map_err(|error| error.to_string())?;
        source_paths(&files)?;
        return Ok(encode_source_files(files));
    }
    let directory = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let files = read_source_files(&directory)?;
    if files.is_empty() {
        return Err("源码文件夹为空".into());
    }
    source_paths(&files)?;
    let marker = directory.join(SOURCE_MARKER);
    if marker.is_file() {
        let _ = fs::write(marker, b"KeySkin source workspace\n");
    }
    app.fs_scope()
        .allow_directory(&directory, true)
        .map_err(|error| error.to_string())?;
    Ok(encode_source_files(files))
}

#[tauri::command]
async fn open_source_workspace_archive(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        return tauri_plugin_native_share::read_source_workspace_archive(&app, path).await;
    }
    let _ = (app, path);
    Err("Compact source archives are only available for Android content URIs".into())
}

#[tauri::command]
async fn apply_source_changes(
    app: tauri::AppHandle,
    path: String,
    changes: Vec<SourceChange>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        return tauri_plugin_native_share::apply_source_changes(
            &app,
            path,
            serde_json::to_value(changes).map_err(|error| error.to_string())?,
        )
        .await;
    }
    let _ = app;
    apply_source_changes_path(path, changes)
}

fn apply_source_changes_path(path: String, changes: Vec<SourceChange>) -> Result<(), String> {
    let directory = fs::canonicalize(path).map_err(|error| error.to_string())?;
    for change in changes {
        let target = source_target(&directory, &change.path)?;
        match change.data {
            Some(data) => {
                if data.len() > MAX_SOURCE_BYTES {
                    return Err("单个源码文件超过 256 MB".into());
                }
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(target, data).map_err(|error| error.to_string())?;
            }
            None => {
                if target.is_file() {
                    fs::remove_file(&target).map_err(|error| error.to_string())?;
                    if let Some(parent) = target.parent() {
                        remove_empty_parents(parent.to_path_buf(), &directory)?;
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn read_source_changes(
    app: tauri::AppHandle,
    path: String,
    changed_paths: Vec<String>,
) -> Result<Vec<SourceChange>, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let value = tauri_plugin_native_share::read_source_workspace(&app, path).await?;
        let files: Vec<SourceFile> =
            serde_json::from_value(value).map_err(|error| error.to_string())?;
        source_paths(&files)?;
        let mut output = vec![SourceChange {
            path: String::new(),
            data: None,
            directory: true,
        }];
        output.extend(files.into_iter().map(|file| SourceChange {
            path: file.path,
            data: Some(file.data),
            directory: false,
        }));
        return Ok(output);
    }
    let _ = app;
    read_source_changes_path(path, changed_paths)
}

fn read_source_changes_path(
    path: String,
    changed_paths: Vec<String>,
) -> Result<Vec<SourceChange>, String> {
    let directory = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let mut output = Vec::new();
    for changed_path in changed_paths {
        let target = canonical_event_path(PathBuf::from(&changed_path));
        let relative = target
            .strip_prefix(&directory)
            .map_err(|_| "源码变动路径不属于当前工作区".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if relative == SOURCE_MARKER
            || relative == SOURCE_MANIFEST
            || relative == ".DS_Store"
            || (!relative.is_empty() && !safe_source_path(&relative))
        {
            continue;
        }
        if target.is_dir() {
            for file in read_source_files(&target)? {
                let nested = if relative.is_empty() {
                    file.path
                } else {
                    format!("{}/{}", relative.trim_end_matches('/'), file.path)
                };
                output.push(SourceChange {
                    path: nested,
                    data: Some(file.data),
                    directory: false,
                });
            }
            output.insert(
                0,
                SourceChange {
                    path: relative,
                    data: None,
                    directory: true,
                },
            );
        } else {
            let missing = !target.exists();
            let data = if target.is_file() {
                Some(fs::read(&target).map_err(|error| error.to_string())?)
            } else {
                None
            };
            output.push(SourceChange {
                path: relative,
                data,
                directory: missing,
            });
        }
    }
    Ok(output)
}

#[tauri::command]
fn path_is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
fn pick_source_directory(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_native_share::pick_source_directory(&app);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("SAF directory selection is only available on Android".into())
    }
}

#[tauri::command]
async fn choose_project_template(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_native_share::choose_project_template(&app).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("native project template selection is only available on Android".into())
    }
}

#[tauri::command]
fn start_source_observer(
    app: tauri::AppHandle,
    path: String,
    handler: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_native_share::start_source_observer(&app, path, handler);
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path, handler);
        Ok(())
    }
}

#[tauri::command]
fn stop_source_observer(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_native_share::stop_source_observer(&app);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

fn valid_share_filename(name: &str) -> bool {
    let path = Path::new(name);
    path.file_name().and_then(|value| value.to_str()) == Some(name)
        && matches!(
            path.extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("bdi" | "bds" | "bda" | "ssf" | "sxi")
        )
}

fn read_file_bytes(path: &str) -> Result<Vec<u8>, String> {
    let size = fs::metadata(path).map_err(|error| error.to_string())?.len();
    if size > MAX_ARCHIVE_BYTES {
        return Err("skin file exceeds 64 MB".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}

/// 皮肤动辄十几 MB：必须走二进制 IPC，把 `Vec<u8>` 序列化成 JSON 数字数组会额外产生
/// 数倍体积的字符串和上亿个数字对象，既慢又占内存。
/// 读写大文件的命令都用 async：同步命令跑在主线程，会卡住窗口拖动与点击。
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    read_file_bytes(&path).map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn skin_file_size(path: String) -> Result<u64, String> {
    let size = fs::metadata(path).map_err(|error| error.to_string())?.len();
    if size > MAX_ARCHIVE_BYTES {
        return Err("skin file exceeds 64 MB".into());
    }
    Ok(size)
}

/// 最近打开缩略图的缓存戳：大小 + 修改时间(ms)，任一变化即视为文件已改。
#[tauri::command]
async fn skin_file_stamp(path: String) -> Result<[u64; 2], String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis() as u64);
    Ok([metadata.len(), modified])
}

#[tauri::command]
async fn read_skin_file(
    path: String,
    progress: tauri::ipc::Channel<[u64; 2]>,
) -> Result<tauri::ipc::Response, String> {
    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_ARCHIVE_BYTES {
        return Err("skin file exceeds 64 MB".into());
    }
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut output = Vec::with_capacity(size as usize);
    let mut chunk = [0; 256 * 1024];
    loop {
        let read = file.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        output.extend_from_slice(&chunk[..read]);
        progress
            .send([output.len() as u64, size])
            .map_err(|error| error.to_string())?;
    }
    Ok(tauri::ipc::Response::new(output))
}

#[tauri::command]
async fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(path, data).map_err(|error| error.to_string())
}

#[tauri::command]
fn append_client_log(
    app: tauri::AppHandle,
    state: tauri::State<'_, ClientLog>,
    lines: String,
) -> Result<(), String> {
    if lines.len() > MAX_CLIENT_LOG_BATCH_BYTES {
        return Err("client log batch exceeds 256 KiB".into());
    }
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    append_client_log_path(&directory, &lines, MAX_CLIENT_LOG_BYTES)
}

#[tauri::command]
fn read_client_logs(
    app: tauri::AppHandle,
    state: tauri::State<'_, ClientLog>,
) -> Result<Vec<ClientLogFile>, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    read_client_log_path(&directory)
}

#[tauri::command]
fn share_file(app: tauri::AppHandle, name: String, data: Vec<u8>) -> Result<(), String> {
    if !valid_share_filename(&name) {
        return Err("invalid skin filename".into());
    }
    #[cfg(target_os = "android")]
    {
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join("shared-skins");
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let path = directory.join(&name);
        fs::write(&path, data).map_err(|error| error.to_string())?;
        tauri_plugin_native_share::share_file(
            &app,
            path.to_string_lossy().into_owned(),
            name,
            "application/octet-stream".into(),
        )?;
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, data);
        Err("native file sharing is only available on Android".into())
    }
}

#[tauri::command]
fn take_opened_files(app: tauri::AppHandle) -> Vec<String> {
    std::mem::take(&mut *app.state::<OpenedFiles>().0.lock().unwrap())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn window_material_kind() -> &'static str {
    #[cfg(target_os = "macos")]
    return "glass";
    #[cfg(target_os = "windows")]
    return windows_material_kind(windows_version::OsVersion::current().build);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return "none";
}

#[cfg(any(target_os = "windows", test))]
fn windows_material_kind(build: u32) -> &'static str {
    if build >= 22_000 {
        "glass"
    } else {
        "acrylic"
    }
}

#[cfg(any(target_os = "windows", test))]
fn acrylic_alpha(opacity: u8) -> u8 {
    ((u16::from(opacity.min(100)) * 255 + 50) / 100) as u8
}

#[tauri::command]
fn set_window_material(
    window: tauri::WebviewWindow,
    enabled: bool,
    opacity: u8,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = opacity;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        if !enabled {
            return window.set_effects(None).map_err(|error| error.to_string());
        }
        #[cfg(target_os = "macos")]
        return window
            .set_effects(EffectsBuilder::new().effect(Effect::Sidebar).build())
            .map_err(|error| error.to_string());
        #[cfg(target_os = "windows")]
        {
            let effect = if window_material_kind() == "glass" {
                EffectsBuilder::new().effect(Effect::Mica)
            } else {
                EffectsBuilder::new()
                    .effect(Effect::Acrylic)
                    .color(tauri::window::Color(32, 34, 38, acrylic_alpha(opacity)))
            };
            return window
                .set_effects(effect.build())
                .map_err(|error| error.to_string());
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, enabled, opacity);
        Ok(())
    }
}

#[tauri::command]
async fn wait_for_left_mouse_release() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

        while unsafe { GetAsyncKeyState(VK_LBUTTON.into()) } < 0 {
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn fetch_release_page() -> Result<String, String> {
    reqwest::Client::builder()
        .user_agent("KeySkin update checker")
        .build()
        .map_err(|error| error.to_string())?
        .get(RELEASES_URL)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())
}

fn validate_model_configuration(configuration: &ModelConfiguration) -> Result<(), String> {
    if configuration.provider.is_empty() || configuration.provider.len() > 64 {
        return Err("模型服务商无效".into());
    }
    if !matches!(
        configuration.protocol.as_str(),
        "anthropic" | "openai-chat" | "openai-responses" | "google"
    ) {
        return Err("不支持的模型服务协议".into());
    }
    if configuration.api_url.len() > 2048 {
        return Err("API 地址过长".into());
    }
    let url = reqwest::Url::parse(configuration.api_url.trim())
        .map_err(|_| "API 地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("API 地址必须是 HTTP 或 HTTPS 地址".into());
    }
    if configuration.model.len() > 256 {
        return Err("模型名称过长".into());
    }
    if configuration.api_key.len() > 16 * 1024 {
        return Err("API 密钥过长".into());
    }
    if !matches!(configuration.kind.as_str(), "" | "image") {
        return Err("模型类型无效".into());
    }
    Ok(())
}

fn model_configuration_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join(MODEL_CONFIG_FILE))
}

fn read_model_configuration_path(path: &Path) -> Result<Option<ModelConfiguration>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let configuration: ModelConfiguration =
        serde_json::from_slice(&bytes).map_err(|error| format!("模型配置文件无效：{error}"))?;
    validate_model_configuration(&configuration)?;
    Ok(Some(configuration))
}

#[cfg(test)]
fn write_model_configuration_path(
    path: &Path,
    configuration: &ModelConfiguration,
) -> Result<(), String> {
    validate_model_configuration(configuration)?;
    write_model_store_path(path, configuration)
}

fn write_model_store_path(
    path: &Path,
    configuration: &impl serde::Serialize,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "模型配置目录无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(configuration).map_err(|error| error.to_string())?;
    fs::write(&temporary, data).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if path.exists() {
            fs::remove_file(path).map_err(|remove_error| remove_error.to_string())?;
            fs::rename(&temporary, path).map_err(|rename_error| rename_error.to_string())?;
        } else {
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[tauri::command]
fn load_model_configuration(app: tauri::AppHandle) -> Result<ModelConfigurationState, String> {
    let path = model_configuration_path(&app)?;
    Ok(ModelConfigurationState {
        configuration: read_model_configuration_path(&path)?,
        configurations: read_model_profiles(&path)?,
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn save_model_configuration(
    app: tauri::AppHandle,
    configurations: Vec<ModelConfiguration>,
) -> Result<ModelConfigurationState, String> {
    let path = model_configuration_path(&app)?;
    save_model_profiles_path(&path, configurations)
}

fn save_model_profiles_path(
    path: &Path,
    configurations: Vec<ModelConfiguration>,
) -> Result<ModelConfigurationState, String> {
    if configurations.len() > 100 {
        return Err("模型配置最多 100 个".into());
    }
    for profile in &configurations {
        validate_model_configuration(profile)?;
    }
    // The first profile stays at the top level so older builds still read it.
    match configurations.first() {
        Some(first) => write_model_store_path(
            path,
            &ModelConfigurationStore {
                configuration: first.clone(),
                configurations: configurations.clone(),
            },
        )?,
        None if path.exists() => fs::remove_file(path).map_err(|error| error.to_string())?,
        None => {}
    }
    Ok(ModelConfigurationState {
        configuration: configurations.first().cloned(),
        configurations,
        path: path.to_string_lossy().into_owned(),
    })
}

fn model_list_url(configuration: &ModelConfiguration) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(&format!(
        "{}/models",
        configuration.api_url.trim().trim_end_matches('/')
    ))
    .map_err(|_| "API 地址无效".to_string())?;
    if configuration.protocol == "google" {
        url.query_pairs_mut()
            .append_pair("key", configuration.api_key.trim());
    }
    Ok(url)
}

fn parse_model_list(protocol: &str, bytes: &[u8]) -> Result<Vec<String>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "模型列表响应不是有效 JSON".to_string())?;
    let entries = if protocol == "google" {
        value.get("models")
    } else {
        value.get("data")
    }
    .and_then(serde_json::Value::as_array)
    .ok_or_else(|| "响应中没有模型列表".to_string())?;
    let mut models: Vec<String> = entries
        .iter()
        .filter_map(|entry| {
            let field = if protocol == "google" { "name" } else { "id" };
            entry.get(field).and_then(serde_json::Value::as_str)
        })
        .map(|name| name.strip_prefix("models/").unwrap_or(name).to_string())
        .filter(|name| !name.is_empty() && name.len() <= 256)
        .collect();
    models.sort_unstable();
    models.dedup();
    Ok(models)
}

async fn request_model_list(configuration: &ModelConfiguration) -> Result<Vec<String>, String> {
    validate_model_configuration(configuration)?;
    if configuration.api_key.trim().is_empty() {
        return Err("请先填写 API 密钥".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("KeySkin model connection test")
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let url = model_list_url(configuration)?;
    let mut request = client.get(url);
    request = match configuration.protocol.as_str() {
        "anthropic" => request
            .header("x-api-key", configuration.api_key.trim())
            .header("anthropic-version", "2023-06-01"),
        "google" => request,
        _ => request.bearer_auth(configuration.api_key.trim()),
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("连接模型服务失败：{}", error.without_url()))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_MODEL_RESPONSE_BYTES {
        return Err("模型列表响应过大".into());
    }
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&bytes);
        let detail = detail.chars().take(400).collect::<String>();
        return Err(if detail.trim().is_empty() {
            format!("模型服务返回 HTTP {status}")
        } else {
            format!("模型服务返回 HTTP {status}：{detail}")
        });
    }
    parse_model_list(&configuration.protocol, &bytes)
}

#[tauri::command]
async fn fetch_model_list(configuration: ModelConfiguration) -> Result<Vec<String>, String> {
    request_model_list(&configuration).await
}

#[tauri::command]
async fn test_model_connection(
    configuration: ModelConfiguration,
) -> Result<ModelConnectionResult, String> {
    let models = request_model_list(&configuration).await?;
    let model_count = models.len();
    Ok(ModelConnectionResult {
        message: if model_count == 0 {
            "连接成功，服务未返回可用模型".into()
        } else {
            format!("连接成功，获取到 {model_count} 个模型")
        },
        model_count,
    })
}

#[tauri::command]
async fn model_http_request(
    app: tauri::AppHandle,
    request: ModelHttpRequest,
    events: tauri::ipc::Channel<ModelHttpEvent>,
) -> Result<(), String> {
    if !request.method.eq_ignore_ascii_case("POST") {
        return Err("模型对话只允许 POST 请求".into());
    }
    if request.body.as_ref().map_or(0, String::len) > MAX_MODEL_CHAT_BYTES {
        return Err("模型请求体过大".into());
    }
    let url = reqwest::Url::parse(&request.url).map_err(|_| "模型请求地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("模型请求地址必须是 HTTP 或 HTTPS 地址".into());
    }
    let profiles = read_model_profiles(&model_configuration_path(&app)?)?;
    if !profiles.iter().any(|profile| {
        let Ok(base) = reqwest::Url::parse(profile.api_url.trim()) else {
            return false;
        };
        let base_path = base.path().trim_end_matches('/');
        url.scheme() == base.scheme()
            && url.host_str() == base.host_str()
            && url.port_or_known_default() == base.port_or_known_default()
            && (url.path() == base_path || url.path().starts_with(&format!("{base_path}/")))
    }) {
        return Err("模型请求地址与已保存的 API 地址不一致".into());
    }
    // Long reasoning streams can run for minutes; only a stalled connection should fail.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let mut outgoing = client.post(url);
    for (name, value) in request.headers {
        if name.eq_ignore_ascii_case("host") || name.eq_ignore_ascii_case("content-length") {
            continue;
        }
        outgoing = outgoing.header(&name, &value);
    }
    let mut response = outgoing
        .body(request.body.unwrap_or_default())
        .send()
        .await
        .map_err(|error| format!("连接模型服务失败：{}", error.without_url()))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    events
        .send(ModelHttpEvent::Headers { status, headers })
        .map_err(|error| error.to_string())?;
    let mut received = 0usize;
    while let Some(chunk) = response.chunk().await.map_err(model_stream_error)? {
        received += chunk.len();
        if received > MAX_MODEL_CHAT_BYTES {
            return Err("模型响应过大".into());
        }
        events
            .send(ModelHttpEvent::Chunk {
                body: chunk.to_vec(),
            })
            .map_err(|error| error.to_string())?;
    }
    events
        .send(ModelHttpEvent::End)
        .map_err(|error| error.to_string())?;
    Ok(())
}

// reqwest reports every mid-stream failure as "error decoding response body"; the cause chain says why.
fn model_stream_error(error: reqwest::Error) -> String {
    let mut detail = String::new();
    let mut cause = std::error::Error::source(&error);
    while let Some(inner) = cause {
        detail.push_str(&format!("：{inner}"));
        cause = inner.source();
    }
    if error.is_timeout() {
        format!("模型响应超时，超过 120 秒没有收到新内容，请重试{detail}")
    } else {
        format!("模型响应中途断开，请检查网络后重试{detail}")
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::{
        acrylic_alpha, append_client_log_path, apply_source_changes_path, model_list_url,
        model_stream_error, parse_model_list, prune_source_workspaces, read_client_log_path,
        read_file, read_file_bytes, read_model_configuration_path, read_source_changes_path,
        read_source_files, safe_source_path, valid_share_filename, windows_material_kind,
        write_file, write_model_configuration_path, write_source_files, ModelConfiguration,
        MAX_ARCHIVE_BYTES, SOURCE_LIMIT, SOURCE_MARKER,
    };
    use std::fs;
    use std::thread;
    use std::time::Duration;

    fn test_model_configuration(protocol: &str) -> ModelConfiguration {
        ModelConfiguration {
            provider: "test".into(),
            protocol: protocol.into(),
            api_url: "https://example.com/v1/".into(),
            model: "model-a".into(),
            api_key: "secret".into(),
            kind: String::new(),
        }
    }

    #[test]
    fn model_configuration_round_trips_as_private_json() {
        let root =
            std::env::temp_dir().join(format!("keyskin-model-config-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let path = root.join("model-config.json");
        let configuration = test_model_configuration("openai-chat");
        write_model_configuration_path(&path, &configuration).expect("write model config");
        assert_eq!(
            super::read_model_profiles(&path).unwrap(),
            vec![configuration.clone()]
        );
        let mut second = configuration.clone();
        second.model = "model-b".into();
        let profiles = vec![configuration.clone(), second];
        super::save_model_profiles_path(&path, profiles.clone()).unwrap();
        assert_eq!(super::read_model_profiles(&path).unwrap(), profiles);
        assert_eq!(
            read_model_configuration_path(&path).expect("read model config"),
            Some(configuration)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        super::save_model_profiles_path(&path, Vec::new()).unwrap();
        assert!(!path.exists());
        fs::remove_dir_all(root).expect("cleanup model config");
    }

    #[test]
    fn model_list_url_normalizes_base_and_protects_google_key() {
        let openai = test_model_configuration("openai-chat");
        assert_eq!(
            model_list_url(&openai).unwrap().as_str(),
            "https://example.com/v1/models"
        );
        let google = test_model_configuration("google");
        assert_eq!(
            model_list_url(&google).unwrap().as_str(),
            "https://example.com/v1/models?key=secret"
        );
    }

    #[test]
    fn model_list_parser_supports_openai_anthropic_and_google_shapes() {
        let data = br#"{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"}]}"#;
        assert_eq!(
            parse_model_list("openai-chat", data).unwrap(),
            vec!["a-model", "z-model"]
        );
        assert_eq!(
            parse_model_list("anthropic", data).unwrap(),
            vec!["a-model", "z-model"]
        );
        let google = br#"{"models":[{"name":"models/gemini-pro"}]}"#;
        assert_eq!(
            parse_model_list("google", google).unwrap(),
            vec!["gemini-pro"]
        );
    }

    #[test]
    fn window_material_distinguishes_windows_10_acrylic_from_windows_11_glass() {
        assert_eq!(windows_material_kind(21_999), "acrylic");
        assert_eq!(windows_material_kind(22_000), "glass");
        assert_eq!(acrylic_alpha(0), 0);
        assert_eq!(acrylic_alpha(100), 255);
    }

    #[test]
    fn file_commands_report_success_and_missing_file_errors() {
        use tauri::async_runtime::block_on;
        let path = std::env::temp_dir().join(format!(
            "keyskin-file-command-{}-{}.bdi",
            std::process::id(),
            1
        ));
        let path_text = path.to_string_lossy().into_owned();
        let data = vec![1, 2, 3, 4];

        block_on(write_file(path_text.clone(), data.clone())).expect("write should succeed");
        assert!(block_on(read_file(path_text.clone())).is_ok());
        assert_eq!(
            read_file_bytes(&path_text).expect("read should succeed"),
            data
        );
        fs::remove_file(&path).expect("cleanup should succeed");
        assert!(block_on(read_file(path_text.clone())).is_err());
        assert!(read_file_bytes(&path_text).is_err());

        let oversized = std::env::temp_dir().join(format!(
            "keyskin-oversized-{}-{}.bdi",
            std::process::id(),
            1
        ));
        fs::File::create(&oversized)
            .expect("create sparse test file")
            .set_len(MAX_ARCHIVE_BYTES + 1)
            .expect("size sparse test file");
        assert!(block_on(read_file(oversized.to_string_lossy().into_owned())).is_err());
        assert!(read_file_bytes(&oversized.to_string_lossy()).is_err());
        fs::remove_file(oversized).expect("cleanup sparse test file");
    }

    #[test]
    fn client_log_rotates_and_keeps_current_and_previous_files() {
        let root = std::env::temp_dir().join(format!("keyskin-client-log-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        append_client_log_path(&root, "first", 8).expect("append first log");
        append_client_log_path(&root, "second", 8).expect("rotate log");
        append_client_log_path(&root, "third", 8).expect("rotate log again");
        let logs = read_client_log_path(&root).expect("read logs");
        assert_eq!(logs.len(), 2);
        assert_eq!(String::from_utf8_lossy(&logs[0].data), "second\n");
        assert_eq!(String::from_utf8_lossy(&logs[1].data), "third\n");
        fs::remove_dir_all(root).expect("cleanup logs");
    }

    #[test]
    fn share_filename_accepts_skin_files_without_path_components() {
        assert!(valid_share_filename("我的皮肤.bds"));
        assert!(valid_share_filename("sample.BDA"));
        assert!(valid_share_filename("搜狗皮肤.ssf"));
        assert!(!valid_share_filename("../sample.bds"));
        assert!(!valid_share_filename("sample.zip"));
        assert!(!valid_share_filename(""));
    }

    #[test]
    fn source_workspace_sync_only_removes_editor_managed_files() {
        let root = std::env::temp_dir().join(format!("keyskin-source-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create source root");
        fs::write(root.join("keep.txt"), b"external").expect("write external file");
        write_source_files(
            &root,
            &[super::SourceFile {
                path: "skin/a.txt".into(),
                data: b"a".to_vec(),
            }],
        )
        .expect("write managed file");
        apply_source_changes_path(
            root.to_string_lossy().into_owned(),
            vec![super::SourceChange {
                path: "skin/a.txt".into(),
                data: None,
                directory: false,
            }],
        )
        .expect("delete managed file");
        assert!(root.join("keep.txt").is_file());
        assert!(!root.join("skin/a.txt").exists());
        fs::remove_dir_all(root).expect("cleanup source root");
    }

    #[cfg(unix)]
    #[test]
    fn source_workspace_sync_rejects_symlinked_parent_paths() {
        use std::os::unix::fs::symlink;

        let root =
            std::env::temp_dir().join(format!("keyskin-source-link-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("keyskin-source-outside-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&root).expect("create source root");
        fs::create_dir_all(&outside).expect("create outside root");
        symlink(&outside, root.join("skin")).expect("create source symlink");

        let result = apply_source_changes_path(
            root.to_string_lossy().into_owned(),
            vec![super::SourceChange {
                path: "skin/a.txt".into(),
                data: Some(b"escaped".to_vec()),
                directory: false,
            }],
        );
        assert!(result.is_err());
        assert!(!outside.join("a.txt").exists());

        fs::remove_dir_all(root).expect("cleanup source root");
        fs::remove_dir_all(outside).expect("cleanup outside root");
    }

    #[test]
    fn built_in_source_pruning_keeps_limit_marked_workspaces() {
        let root = std::env::temp_dir().join(format!("keyskin-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create source root");
        for index in 0..=SOURCE_LIMIT {
            let directory = root.join(format!("workspace-{index}"));
            fs::create_dir_all(&directory).expect("create workspace");
            fs::write(directory.join(SOURCE_MARKER), b"managed").expect("mark workspace");
            thread::sleep(Duration::from_millis(5));
        }
        let unmanaged = root.join("user-folder");
        fs::create_dir_all(&unmanaged).expect("create unmanaged folder");
        prune_source_workspaces(&root).expect("prune workspaces");
        let marked = fs::read_dir(&root)
            .expect("read source root")
            .filter_map(Result::ok)
            .filter(|entry| entry.path().join(SOURCE_MARKER).is_file())
            .count();
        assert_eq!(marked, SOURCE_LIMIT);
        assert!(!root.join("workspace-0").exists());
        assert!(unmanaged.is_dir());
        fs::remove_dir_all(root).expect("cleanup source root");
    }

    #[test]
    fn source_transfer_round_trips_binary_files_as_base64() {
        let files = vec![
            super::SourceFile {
                path: "1080/图片.png".into(),
                data: (0..=255).collect(),
            },
            super::SourceFile {
                path: "empty.ini".into(),
                data: Vec::new(),
            },
        ];
        let encoded = super::encode_source_files(files.clone());
        assert!(serde_json::to_value(&encoded).unwrap()[0]["data"].is_string());
        assert_eq!(super::decode_source_files(encoded).unwrap(), files);
    }

    #[test]
    fn source_reader_accepts_empty_change_snapshots_and_limits_paths() {
        let root =
            std::env::temp_dir().join(format!("keyskin-empty-source-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create source root");
        assert!(read_source_files(&root)
            .expect("read empty snapshot")
            .is_empty());
        assert!(safe_source_path("skin/port/layout.ini"));
        assert!(!safe_source_path("../outside"));
        assert!(!safe_source_path("/absolute"));
        fs::remove_dir_all(root).expect("cleanup source root");
    }

    #[test]
    fn model_stream_error_explains_truncated_body() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("address");
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept");
            let _ = socket.read(&mut [0; 1024]);
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial")
                .expect("write");
        });
        let message = tauri::async_runtime::block_on(async {
            let mut response = reqwest::get(format!("http://{address}"))
                .await
                .expect("headers");
            loop {
                match response.chunk().await {
                    Ok(Some(_)) => continue,
                    Ok(None) => panic!("truncated body should fail"),
                    Err(error) => break model_stream_error(error),
                }
            }
        });
        server.join().expect("server");
        assert!(message.starts_with("模型响应中途断开"), "{message}");
        assert!(message.contains('：'), "cause chain missing: {message}");
    }

    #[test]
    fn source_reader_expands_workspace_root_events() {
        let root = std::env::temp_dir().join(format!("keyskin-root-event-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create source root");
        fs::write(root.join("Info.txt"), b"Name=changed").expect("write info");
        let changes = read_source_changes_path(
            root.to_string_lossy().into_owned(),
            vec![root.to_string_lossy().into_owned()],
        )
        .expect("read root event");
        assert!(changes
            .iter()
            .any(|change| change.path == "Info.txt" && change.data.is_some()));
        assert!(changes
            .iter()
            .any(|change| change.path.is_empty() && change.directory));
        let deleted = read_source_changes_path(
            root.to_string_lossy().into_owned(),
            vec![root.join("removed.tmp").to_string_lossy().into_owned()],
        )
        .expect("read missing file event");
        assert!(deleted
            .iter()
            .any(|change| change.path == "removed.tmp" && change.data.is_none()));
        fs::remove_dir_all(root).expect("cleanup source root");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_native_share::init())
        .manage(ClientLog(Mutex::new(())))
        .manage(OpenedFiles(Mutex::new(Vec::new())));
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        read_file,
        skin_file_size,
        skin_file_stamp,
        read_skin_file,
        write_file,
        append_client_log,
        read_client_logs,
        share_file,
        take_opened_files,
        quit_app,
        window_material_kind,
        set_window_material,
        wait_for_left_mouse_release,
        fetch_release_page,
        load_model_configuration,
        save_model_configuration,
        fetch_model_list,
        test_model_connection,
        model_http_request,
        prepare_source_directory,
        create_source_workspace,
        open_source_workspace,
        open_source_workspace_archive,
        apply_source_changes,
        read_source_changes,
        path_is_directory,
        pick_source_directory,
        choose_project_template,
        start_source_observer,
        stop_source_observer
    ]);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        read_file,
        skin_file_size,
        skin_file_stamp,
        read_skin_file,
        write_file,
        append_client_log,
        read_client_logs,
        share_file,
        take_opened_files,
        quit_app,
        window_material_kind,
        set_window_material,
        wait_for_left_mouse_release,
        fetch_release_page,
        load_model_configuration,
        save_model_configuration,
        fetch_model_list,
        test_model_connection,
        model_http_request,
        prepare_source_directory,
        create_source_workspace,
        open_source_workspace,
        open_source_workspace_archive,
        apply_source_changes,
        read_source_changes,
        path_is_directory,
        pick_source_directory,
        choose_project_template,
        start_source_observer,
        stop_source_observer
    ]);
    builder
        .build(tauri::generate_context!())
        .expect("failed to build BDI editor")
        .run(|app, event| {
            #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
            let _ = (&app, &event);
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::Emitter;
                let paths: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| {
                        #[cfg(target_os = "android")]
                        if url.scheme() == "content" {
                            return Some(url.to_string());
                        }
                        url.to_file_path()
                            .ok()
                            .map(|path| path.to_string_lossy().into_owned())
                    })
                    .collect();
                app.state::<OpenedFiles>()
                    .0
                    .lock()
                    .unwrap()
                    .extend(paths.clone());
                let _ = app.emit("opened", paths);
            }
        });
}
