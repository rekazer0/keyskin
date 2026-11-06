use std::fs;
use std::io::{Read, Write};
use std::net::IpAddr;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbSettings {
    executable: String,
    serial: String,
    directory: String,
    package: String,
    activity: String,
    preview_activity: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    port: String,
}

impl AdbSettings {
    fn validate(&self) -> Result<(), String> {
        if self.executable.trim().is_empty()
            || self.executable.starts_with('-')
            || self.executable.chars().any(char::is_control)
        {
            return Err("请在设置中填写 ADB 可执行文件路径".into());
        }
        if self.serial.starts_with('-') || self.serial.chars().any(char::is_whitespace) {
            return Err("设备序列号不能包含空白或以 - 开头".into());
        }
        let safe_name = |s: &str| {
            !s.is_empty()
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._".contains(&c))
        };
        if !safe_name(&self.package) || !self.package.contains('.') {
            return Err("百度输入法包名无效".into());
        }
        if [&self.activity, &self.preview_activity]
            .iter()
            .any(|name| !name.is_empty() && !safe_name(name))
        {
            return Err("预览 Activity 请填写类名，不含包名/前缀或命令参数".into());
        }
        if !self.directory.is_empty()
            && (!(self.directory.starts_with("/sdcard/")
                || self.directory.starts_with("/storage/emulated/0/"))
                || self
                    .directory
                    .split('/')
                    .any(|part| part == ".." || part == ".")
                || !self
                    .directory
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"/_-.".contains(&c)))
        {
            return Err(
                "设备目录须位于 /sdcard/ 或 /storage/emulated/0/ 下，且仅含英文、数字、/_-.".into(),
            );
        }
        self.network_target()?;
        Ok(())
    }

    fn network_target(&self) -> Result<Option<String>, String> {
        if self.host.is_empty() && self.port.is_empty() {
            return Ok(None);
        }
        network_endpoint(&self.host, &self.port).map(Some)
    }
}

fn network_endpoint(host: &str, port: &str) -> Result<String, String> {
    let ip = host
        .parse::<IpAddr>()
        .map_err(|_| "请填写有效的设备 IP（IPv4 或 IPv6，不含端口）")?;
    let port = port
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or("端口须为 1–65535 的整数")?;
    Ok(std::net::SocketAddr::new(ip, port).to_string())
}

fn run_adb(executable: &str, args: &[&str]) -> Result<String, String> {
    run_adb_input(executable, args, None)
}

fn run_adb_input(executable: &str, args: &[&str], input: Option<&str>) -> Result<String, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // 不为每条 ADB 命令弹出控制台。
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 ADB，请检查设置中的路径：{e}"))?;
    let read = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.read_to_end(&mut bytes).map(|_| bytes)
        })
    };
    let stdout = read(Box::new(child.stdout.take().unwrap()));
    let stderr = read(Box::new(child.stderr.take().unwrap()));
    if let Some(input) = input {
        if let Err(error) = child.stdin.take().unwrap().write_all(input.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("无法提交 ADB 配对码：{error}"));
        }
    }
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() < Duration::from_secs(60) => {
                std::thread::sleep(Duration::from_millis(50));
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(match result {
                    Err(error) => format!("读取 ADB 状态失败：{error}"),
                    _ => "ADB 操作超时，请检查设备连接后重试".into(),
                });
            }
        }
    };
    let output = stdout
        .join()
        .map_err(|_| "读取 ADB 输出失败")?
        .map_err(|e| e.to_string())?;
    let errors = stderr
        .join()
        .map_err(|_| "读取 ADB 错误失败")?
        .map_err(|e| e.to_string())?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output),
        String::from_utf8_lossy(&errors)
    );
    if !status?.success()
        || text.lines().any(|line| {
            let line = line.trim();
            line.starts_with("Error:")
                || line.starts_with("Error type")
                || line.starts_with("Exception")
        })
    {
        return Err(format!("ADB 执行失败：{}", text.trim()));
    }
    Ok(text)
}

fn select_device(output: &str, requested: &str) -> Result<String, String> {
    let devices: Vec<_> = output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?;
            let state = parts.next()?;
            (state == "device" || state == "offline" || state == "unauthorized")
                .then_some((serial, state))
        })
        .collect();
    let (serial, state) = if requested.is_empty() {
        match devices.as_slice() {
            [device] => *device,
            [] => return Err("未找到 Android 设备，请连接设备并开启 USB 调试".into()),
            _ => return Err("检测到多台设备，请在设置中填写目标设备序列号（adb devices）".into()),
        }
    } else {
        *devices
            .iter()
            .find(|(serial, _)| *serial == requested)
            .ok_or("未找到指定设备，请检查设置中的设备序列号和 ADB 连接")?
    };
    match state {
        "unauthorized" => Err("设备尚未授权，请在手机上允许此电脑进行 USB 调试".into()),
        "offline" => Err("设备已离线，请重新连接后重试".into()),
        _ => Ok(serial.into()),
    }
}

fn connect(settings: &AdbSettings) -> Result<String, String> {
    settings.validate()?;
    let target = settings.network_target()?;
    if let Some(target) = &target {
        let result = run_adb(&settings.executable, &["connect", target])?;
        if !result.lines().any(|line| {
            line.starts_with("connected to ") || line.starts_with("already connected to ")
        }) {
            return Err(format!(
                "网络 ADB 连接失败：{}。请检查 IP、连接端口；无线调试请先配对设备",
                result.trim()
            ));
        }
    }
    let devices = run_adb(&settings.executable, &["devices"])?;
    let serial = select_device(&devices, target.as_deref().unwrap_or(&settings.serial))?;
    let installed = run_adb(
        &settings.executable,
        &["-s", &serial, "shell", "pm", "path", &settings.package],
    )?;
    if !installed.lines().any(|line| line.starts_with("package:")) {
        return Err(format!(
            "设备未安装 {}，请检查设置中的百度输入法包名",
            settings.package
        ));
    }
    Ok(serial)
}

#[tauri::command]
pub async fn pair_adb_device(
    settings: AdbSettings,
    pair_port: String,
    code: String,
) -> Result<(), String> {
    if !cfg!(any(target_os = "windows", target_os = "macos")) {
        return Err("ADB 配对仅支持 Windows 和 macOS 客户端".into());
    }
    tauri::async_runtime::spawn_blocking(move || pair(&settings, &pair_port, &code))
        .await
        .map_err(|e| e.to_string())?
}

fn pair(settings: &AdbSettings, port: &str, code: &str) -> Result<(), String> {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("请填写手机无线调试页面显示的六位配对码".into());
    }
    let target = network_endpoint(&settings.host, port)?;
    // 配对不要求连接端口已经填好。
    let validation = AdbSettings {
        host: String::new(),
        port: String::new(),
        ..settings.clone()
    };
    validation.validate()?;
    // 配对码仅通过标准输入传入，不出现在进程参数或错误消息中。
    let output = run_adb_input(
        &settings.executable,
        &["pair", &target],
        Some(&format!("{code}\n")),
    )
    .map_err(|error| error.replace(code, "[已隐藏]"))?;
    if !output.contains("Successfully paired to ") {
        return Err(
            "ADB 配对失败，请检查配对端口和配对码；可能需要更新 Android Platform Tools".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn test_adb_connection(settings: AdbSettings) -> Result<String, String> {
    if !cfg!(any(target_os = "windows", target_os = "macos")) {
        return Err("ADB 分享仅支持 Windows 和 macOS 客户端".into());
    }
    tauri::async_runtime::spawn_blocking(move || connect(&settings))
        .await
        .map_err(|e| e.to_string())?
}

fn valid_skin_name(name: &str, format: &str) -> bool {
    name.ends_with(&format!(".{format}"))
        && name.len() <= 240
        && !name.starts_with('.')
        && !name
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
}

fn device_file_uri(path: &str) -> String {
    let mut uri = String::from("file://");
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
            uri.push(byte as char);
        } else {
            uri.push_str(&format!("%{byte:02X}"));
        }
    }
    uri
}

fn keyboard_ready(output: &str, package: &str) -> bool {
    output.lines().any(|line| {
        line.contains(&format!("mCurId={package}/")) && line.contains("mBoundToMethod=true")
    })
}

fn share(
    settings: AdbSettings,
    format: String,
    name: String,
    data: Vec<u8>,
    progress: impl Fn(&str),
) -> Result<String, String> {
    if !matches!(format.as_str(), "bds" | "bda") || data.is_empty() || data.len() > 64 * 1024 * 1024
    {
        return Err("无效的 Android 皮肤包（仅支持 BDS/BDA，最大 64 MB）".into());
    }
    if !valid_skin_name(&name, &format) {
        return Err("皮肤文件名无效，请使用不含路径的 BDS/BDA 文件名".into());
    }
    let serial = connect(&settings)?;
    let adb = |args: &[&str]| {
        let mut all = vec!["-s", serial.as_str()];
        all.extend_from_slice(args);
        run_adb(&settings.executable, &all)
    };
    let selected = adb(&["shell", "settings", "get", "secure", "default_input_method"])?;
    if selected.trim().split('/').next() != Some(settings.package.as_str()) {
        return Err("请先在设备的系统输入法设置中将百度输入法设为当前输入法，再重新分享；未更改设备默认输入法".into());
    }
    progress("正在准备百度键盘服务；请保持设备解锁，必要时点一下试打输入框");
    if !settings.preview_activity.is_empty() {
        let preview = format!("{}/{}", settings.package, settings.preview_activity);
        adb(&[
            "shell",
            "am",
            "start",
            "-W",
            "-f",
            "0x10008000",
            "-n",
            &preview,
            "--ei",
            "key_uid",
            "48424",
        ])?;
    }
    let ready_started = Instant::now();
    while !keyboard_ready(
        &adb(&["shell", "dumpsys", "input_method"])?,
        &settings.package,
    ) {
        if ready_started.elapsed() > Duration::from_secs(15) {
            return Err(
                "百度键盘服务尚未就绪，请在设备试打页点一下输入框，确认百度键盘弹出后重新分享"
                    .into(),
            );
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = std::env::temp_dir().join(format!("keyskin-adb-{}-{id}", std::process::id()));
    fs::create_dir(&temporary).map_err(|e| e.to_string())?;
    let local = temporary.join(&name);
    let directory = if settings.directory.is_empty() {
        format!("/sdcard/Android/data/{}/files/KeySkin", settings.package)
    } else {
        settings.directory.trim_end_matches('/').to_owned()
    };
    let remote = format!("{directory}/{name}");
    let result = (|| {
        fs::write(&local, data).map_err(|e| e.to_string())?;
        adb(&["shell", "mkdir", "-p", &directory])?;
        adb(&["push", local.to_str().ok_or("临时文件路径无效")?, &remote])?;
        progress("皮肤已推送，正在启动百度输入法导入；若设备弹出提示，请先在设备端处理");
        // ACTION_VIEW 与 Android 客户端的分享入口一致；仅传递校验过的参数，绝不执行自定义 shell。
        let uri = device_file_uri(&remote);
        let mut args = vec![
            "shell",
            "am",
            "start",
            "-W",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            &uri,
            "-t",
            "application/octet-stream",
            "-f",
            "0x10008000",
            "--ez",
            "exhibit",
            "true",
            "--ez",
            "ask",
            "false",
        ];
        let component;
        if settings.activity.is_empty() {
            args.extend(["-p", &settings.package]);
        } else {
            component = format!("{}/{}", settings.package, settings.activity);
            args.extend(["-n", &component]);
        }
        adb(&args).map_err(|e| format!("皮肤已推送到 {remote}，但启动预览失败：{e}。请检查包名、Activity 和输入法文件访问权限"))?;
        progress("等待百度输入法完成导入；请在设备上查看兼容性或权限提示，处理后将继续预览");
        if !settings.preview_activity.is_empty() {
            let import_activity = if settings.activity.starts_with('.') {
                format!("{}{}", settings.package, settings.activity)
            } else {
                settings.activity.clone()
            };
            let started = Instant::now();
            loop {
                let activities = adb(&["shell", "dumpsys", "activity", "activities"])?;
                let importing = activities
                    .lines()
                    .filter(|line| {
                        line.contains("topResumedActivity") || line.contains("mResumedActivity")
                    })
                    .any(|line| {
                        line.contains(&settings.package)
                            && (import_activity.is_empty()
                                || line.contains(&settings.activity)
                                || line.contains(&import_activity))
                    });
                if !importing {
                    break;
                }
                if started.elapsed() > Duration::from_secs(45) {
                    return Err("皮肤已推送，百度输入法仍停留在导入页；请在设备上处理兼容性/权限提示后重新分享，未启动旧皮肤预览".into());
                }
                std::thread::sleep(Duration::from_millis(300));
            }
            progress("导入页面已退出，正在启动百度输入法预览…");
            let preview = format!("{}/{}", settings.package, settings.preview_activity);
            adb(&[
                "shell", "am", "start", "-W", "-n", &preview, "--ei", "key_uid", "48424",
            ])
            .map_err(|e| format!("导入入口已退出，但启动预览失败：{e}"))?;
        }
        Ok(serial.clone())
    })();
    let _ = fs::remove_dir_all(temporary);
    // 设备上的皮肤保留到下次分享覆盖，避免输入法异步读取时文件已被删除。
    result
}

#[tauri::command]
pub async fn share_skin_adb(
    settings: AdbSettings,
    format: String,
    name: String,
    data: Vec<u8>,
    progress: tauri::ipc::Channel<String>,
) -> Result<String, String> {
    if !cfg!(any(target_os = "windows", target_os = "macos")) {
        return Err("ADB 分享仅支持 Windows 和 macOS 客户端".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        share(settings, format, name, data, |detail| {
            let _ = progress.send(detail.to_owned());
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> AdbSettings {
        AdbSettings {
            executable: "adb".into(),
            serial: "".into(),
            directory: "/sdcard/Download/KeySkin".into(),
            package: "com.baidu.input".into(),
            activity: "".into(),
            preview_activity: "".into(),
            host: String::new(),
            port: String::new(),
        }
    }

    #[test]
    fn skin_names_preserve_unicode_and_escape_file_uris() {
        assert!(valid_skin_name("森 · 皮肤.bds", "bds"));
        for name in [
            "../skin.bds",
            "/skin.bds",
            "a\\skin.bds",
            "a\nskin.bds",
            "skin.bda",
            ".bds",
        ] {
            assert!(!valid_skin_name(name, "bds"));
        }
        assert_eq!(
            device_file_uri("/sdcard/测试 皮肤.bds"),
            "file:///sdcard/%E6%B5%8B%E8%AF%95%20%E7%9A%AE%E8%82%A4.bds"
        );
        assert_eq!(
            device_file_uri("/sdcard/a'$(id);#.bds"),
            "file:///sdcard/a%27%24%28id%29%3B%23.bds"
        );
    }

    #[test]
    fn device_selection_requires_one_authorized_target() {
        assert_eq!(
            select_device("List of devices attached\na\tdevice\n", "").unwrap(),
            "a"
        );
        assert!(select_device("", "").unwrap_err().contains("未找到"));
        assert!(select_device("a\tdevice\nb\tdevice", "")
            .unwrap_err()
            .contains("多台"));
        assert_eq!(select_device("a\tdevice\nb\tdevice", "b").unwrap(), "b");
        assert!(select_device("a\tunauthorized", "a")
            .unwrap_err()
            .contains("授权"));
        assert!(select_device("a\toffline", "")
            .unwrap_err()
            .contains("离线"));
        assert!(select_device("a\tdevice", "b").is_err());
    }

    #[test]
    fn rejects_remote_shell_injection_and_path_traversal() {
        assert!(settings().validate().is_ok());
        for directory in [
            "/data/local/tmp",
            "/sdcard/../data",
            "/sdcard/a;reboot",
            "/sdcard/a b",
            "/sdcard/$(id)",
        ] {
            assert!(AdbSettings {
                directory: directory.into(),
                ..settings()
            }
            .validate()
            .is_err());
        }
        for package in ["com.baidu.input;reboot", "-a", "com.baidu input"] {
            assert!(AdbSettings {
                package: package.into(),
                ..settings()
            }
            .validate()
            .is_err());
        }
        assert!(AdbSettings {
            activity: ".SkinActivity".into(),
            ..settings()
        }
        .validate()
        .is_ok());
        assert!(AdbSettings {
            activity: "x --es cmd reboot".into(),
            ..settings()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn network_endpoints_validate_ip_and_port() {
        assert!(settings().network_target().unwrap().is_none());
        assert_eq!(
            network_endpoint("127.0.0.1", "12345").unwrap(),
            "127.0.0.1:12345"
        );
        assert_eq!(network_endpoint("::1", "12345").unwrap(), "[::1]:12345");
        for (host, port) in [
            ("", "12345"),
            ("127.0.0.1", ""),
            ("127.0.0.1:1", "12345"),
            ("127.0.0.1", "0"),
            ("127.0.0.1", "65536"),
            ("127.0.0.1;id", "1"),
        ] {
            assert!(network_endpoint(host, port).is_err());
        }
        assert!(pair(&settings(), "12345", "bad")
            .unwrap_err()
            .contains("六位"));
    }

    #[cfg(unix)]
    #[test]
    fn network_connect_and_pair_use_one_target_and_stdin_without_leaking_codes() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!(
            "keyskin-adb-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let executable = root.join("adb");
        let write = |body: &str| {
            fs::write(&executable, format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        };
        let config = AdbSettings {
            executable: executable.to_str().unwrap().into(),
            host: "127.0.0.1".into(),
            port: "12345".into(),
            serial: "ignored-usb-device".into(),
            ..settings()
        };
        write("case \"$1\" in\nconnect) echo \"connected to $2\";;\ndevices) printf 'other-device\\tdevice\\n127.0.0.1:12345\\tdevice\\n';;\n-s) test \"$2\" = '127.0.0.1:12345' || exit 1; case \"$4\" in pm) echo package:/test.apk;; settings) echo com.baidu.input/.ImeService;; dumpsys) echo 'mCurId=com.baidu.input/.ImeService mBoundToMethod=true';; esac;;\npair) test \"$#\" -eq 2 || exit 1; read -r code; test \"${#code}\" -eq 6 || exit 1; echo \"Successfully paired to $2\";;\nesac");
        assert_eq!(connect(&config).unwrap(), "127.0.0.1:12345");
        let messages = std::cell::RefCell::new(Vec::new());
        assert!(share(
            config.clone(),
            "bds".into(),
            "测试 皮肤.bds".into(),
            vec![1],
            |detail| messages.borrow_mut().push(detail.to_owned())
        )
        .is_ok());
        assert!(messages
            .borrow()
            .iter()
            .any(|message| message.contains("皮肤已推送")));
        assert!(messages
            .borrow()
            .iter()
            .any(|message| message.contains("兼容性或权限提示")));
        assert!(keyboard_ready(
            "mCurId=com.baidu.input/.ImeService mBoundToMethod=true",
            "com.baidu.input"
        ));
        assert!(!keyboard_ready(
            "mCurId=com.other/.ImeService mBoundToMethod=true",
            "com.baidu.input"
        ));
        assert!(!keyboard_ready(
            "mCurId=com.baidu.input/.ImeService mBoundToMethod=false",
            "com.baidu.input"
        ));
        write("case \"$1\" in connect) echo \"connected to $2\";; devices) printf '127.0.0.1:12345\\tdevice\\n';; -s) case \"$4\" in pm) echo package:/test.apk;; settings) echo com.other/.ImeService;; *) exit 1;; esac;; esac");
        assert!(share(
            config.clone(),
            "bds".into(),
            "test.bds".into(),
            vec![1],
            |_| {}
        )
        .unwrap_err()
        .contains("设为当前输入法"));
        write("case \"$1\" in pair) read -r code; echo \"Successfully paired to $2\";; esac");
        let code = "1".repeat(6);
        assert!(pair(
            &AdbSettings {
                port: String::new(),
                ..config.clone()
            },
            "23456",
            &code
        )
        .is_ok());
        write("echo 'failed to connect'; exit 0");
        assert!(connect(&config).unwrap_err().contains("网络 ADB 连接失败"));
        write("read -r code; echo \"Error: invalid $code\"; exit 1");
        let error = pair(&config, "23456", &code).unwrap_err();
        assert!(!error.contains(&code));
        assert!(error.contains("已隐藏"));
        fs::remove_dir_all(root).unwrap();
    }
}
