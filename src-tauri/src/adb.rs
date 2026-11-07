use std::fs;
use std::io::{Read, Write};
use std::net::IpAddr;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbSettings {
    executable: String,
    serial: String,
    directory: String,
    package: String,
    activity: String,
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
        if !self.activity.is_empty() && !safe_name(&self.activity)
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
/// 手机端输入法：皮肤格式、导入入口与目录都由它决定，包名是唯一判据。
#[derive(Clone, Copy, PartialEq, Eq)]
enum SkinTarget {
    Baidu,
    Sogou,
    ShouXin,
    Custom,
}

impl SkinTarget {
    fn of(package: &str) -> Self {
        if package.starts_with("com.baidu.input") {
            Self::Baidu
        } else if package.starts_with("com.sohu.inputmethod.sogou") {
            Self::Sogou
        } else if package.starts_with("com.xinshuru.inputmethod") {
            Self::ShouXin
        } else {
            Self::Custom
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Baidu => "百度输入法",
            Self::Sogou => "搜狗输入法",
            Self::ShouXin => "手心输入法",
            Self::Custom => "输入法",
        }
    }

    /// 各输入法手机端能安装的皮肤包格式。
    fn formats(self) -> &'static [&'static str] {
        match self {
            Self::Baidu | Self::Custom => &["bds", "bda"],
            Self::Sogou => &["ssf"],
            Self::ShouXin => &["sxi"],
        }
    }

    /// 接收皮肤文件的界面；设置里留空时用它。
    fn import_activity(self) -> Option<&'static str> {
        match self {
            Self::Baidu => Some(".ImeUpdateActivity"),
            Self::ShouXin => Some(".FTInputSettingsActivity"),
            _ => None,
        }
    }

    /// adb shell 会再次解析参数，通配 MIME 必须引用，避免展开成设备文件路径。
    fn mime_type(self) -> &'static str {
        match self {
            Self::Baidu => "application/octet-stream",
            _ => "'*/*'",
        }
    }

}

/// 默认放在输入法自己的外部目录：没有存储权限的输入法也能读。
fn skin_directory(settings: &AdbSettings) -> String {
    if settings.directory.is_empty() {
        if SkinTarget::of(&settings.package) == SkinTarget::Sogou {
            format!("/sdcard/Android/data/{}/files/sga/wallpaper", settings.package)
        } else {
            format!("/sdcard/Android/data/{}/files/KeySkin", settings.package)
        }
    } else {
        settings.directory.trim_end_matches('/').to_owned()
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
            "设备未安装 {}（{}），请检查设置中的输入法包名",
            settings.package,
            SkinTarget::of(&settings.package).name()
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
        uri.push_str(&device_uri_byte(byte));
    }
    uri
}

fn device_uri_byte(byte: u8) -> String {
    if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
        (byte as char).to_string()
    } else {
        format!("%{byte:02X}")
    }
}

fn ui_bounds_for_label(xml: &str, label: &str) -> Option<(i32, i32)> {
    let markers = [format!("text=\"{label}\""), format!("content-desc=\"{label}\"")];
    let (start, _) = markers
        .iter()
        .filter_map(|marker| xml.find(marker).map(|start| (start, marker)))
        .min_by_key(|(start, _)| *start)?;
    let node_start = xml[..start].rfind("<node")?;
    let node_end = xml[start..].find("/>").map(|offset| start + offset)?;
    let node = &xml[node_start..node_end];
    let bounds = node.split("bounds=\"").nth(1)?.split('"').next()?;
    let numbers: Vec<i32> = bounds
        .trim_matches(&['[', ']'][..])
        .split(|character: char| matches!(character, '[' | ']' | ','))
        .filter_map(|value| value.parse().ok())
        .collect();
    (numbers.len() == 4).then_some(((numbers[0] + numbers[2]) / 2, (numbers[1] + numbers[3]) / 2))
}

fn ui_bounds_for_local_card(xml: &str) -> Option<(i32, i32)> {
    let marker = "text=\"(本地)\"";
    let start = xml.find(marker)?;
    let image_marker = "class=\"android.widget.ImageView\"";
    let clickable_marker = "clickable=\"true\"";
    let mut cursor = start;
    let image_start = loop {
        let offset = xml[..cursor].rfind(image_marker)?;
        let node_start = xml[..offset].rfind("<node")?;
        let node_end = xml[offset..].find("/>").map(|end| offset + end)?;
        let node = &xml[node_start..node_end];
        if node.contains(clickable_marker) {
            break node_start;
        }
        cursor = offset;
    };
    let node_end = xml[image_start..].find("/>").map(|offset| image_start + offset)?;
    let node = &xml[image_start..node_end];
    let bounds = node.split("bounds=\"").nth(1)?.split('"').next()?;
    let numbers: Vec<i32> = bounds
        .trim_matches(&['[', ']'][..])
        .split(|character: char| matches!(character, '[' | ']' | ','))
        .filter_map(|value| value.parse().ok())
        .collect();
    (numbers.len() == 4).then_some(((numbers[0] + numbers[2]) / 2, (numbers[1] + numbers[3]) / 2))
}

fn ui_dump_path(output: &str) -> Option<&str> {
    output.lines().find_map(|line| {
        let marker = line
            .find("dumped to:")
            .map(|index| index + "dumped to:".len())?;
        let path = line[marker..].trim();
        (!path.is_empty()).then_some(path)
    })
}

fn dump_ui(adb: &impl Fn(&[&str]) -> Result<String, String>) -> Result<String, String> {
    let preferred = "/data/local/tmp/keyskin-window.xml";
    let legacy = "/sdcard/keyskin-window.xml";
    let _ = adb(&["shell", "rm", "-f", preferred, legacy])?;
    let output = adb(&[
        "shell",
        "uiautomator",
        "dump",
        preferred,
    ])?;
    let path = ui_dump_path(&output).unwrap_or(preferred);
    match adb(&["shell", "cat", path]) {
        Ok(xml) => Ok(xml),
        Err(_) if path != legacy => {
            let output = adb(&["shell", "uiautomator", "dump", legacy])?;
            let path = ui_dump_path(&output).unwrap_or(legacy);
            adb(&["shell", "cat", path])
        }
        Err(error) => Err(error),
    }
}

fn tap_ui_text(adb: &impl Fn(&[&str]) -> Result<String, String>, text: &str) -> Result<bool, String> {
    let xml = dump_ui(adb)?;
    if let Some((x, y)) = ui_bounds_for_label(&xml, text) {
        adb(&["shell", "input", "tap", &x.to_string(), &y.to_string()])?;
        return Ok(true);
    }
    Ok(false)
}

fn tap_ui_local_card(adb: &impl Fn(&[&str]) -> Result<String, String>) -> Result<bool, String> {
    let xml = dump_ui(adb)?;
    if let Some((x, y)) = ui_bounds_for_local_card(&xml) {
        adb(&["shell", "input", "tap", &x.to_string(), &y.to_string()])?;
        return Ok(true);
    }
    Ok(false)
}

/// 搜狗的深链有时落在首页而不是「我的皮肤」，用首页的「皮肤」入口兜底。
fn open_sogou_skins(
    adb: &impl Fn(&[&str]) -> Result<String, String>,
    package: &str,
) -> Result<(), String> {
    // CLEAR_TASK 让深链从任何残留页面（详情/试打页）都能重新落到「我的皮肤」。
    let deep_link = [
        "shell", "am", "start", "-W", "-f", "0x10008000", "-n",
        &format!("{package}/com.sogou.inputmethod.navigation.UniRouteActivity"),
        "-a", "android.intent.action.VIEW", "-d", "sogou://com.sogou.sogouinput/mine-my-skins",
    ];
    let started = Instant::now();
    let mut launched = false;
    let mut retried = false;
    while started.elapsed() < Duration::from_secs(15) {
        if !launched {
            adb(&deep_link)?;
            launched = true;
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        let xml = dump_ui(adb)?;
        if ui_bounds_for_local_card(&xml).is_some() || ui_bounds_for_label(&xml, "我的制作").is_some() {
            return Ok(());
        }
        if tap_ui_text(adb, "皮肤")? {
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        if !retried && started.elapsed() > Duration::from_secs(8) {
            retried = true;
            launched = false;
            continue;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("未能打开搜狗输入法的「我的皮肤」页面，请确认设备已解锁后重试".into())
}

/// 打开第一张「(本地)」皮肤并点「立即启用」，顺带处理音效确认弹窗。
fn apply_sogou_skin(adb: &impl Fn(&[&str]) -> Result<String, String>) -> Result<(), String> {
    if !tap_ui_local_card(adb)? {
        return Err("搜狗输入法的「我的皮肤」里没有本地皮肤，请确认皮肤已推送".into());
    }
    std::thread::sleep(Duration::from_millis(1200));
    let started = Instant::now();
    let mut opened = false;
    while started.elapsed() < Duration::from_secs(12) {
        if tap_ui_text(adb, "立即启用")? || tap_ui_text(adb, "启用")? {
            opened = true;
            break;
        }
        if tap_ui_text(adb, "暂不定制")? {
            std::thread::sleep(Duration::from_millis(800));
            continue;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    if !opened {
        return Err("搜狗皮肤详情页没有「立即启用」，请重试".into());
    }
    // 带音效的皮肤会额外询问是否开启播放；没有弹窗就直接继续。
    for _ in 0..6 {
        if tap_ui_text(adb, "确定")? {
            break;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Ok(())
}

/// 当前分享的取消开关；「取消」命令只影响正在进行的这一次分享。
static ACTIVE_SHARE_CANCEL: std::sync::Mutex<Option<std::sync::Arc<AtomicBool>>> =
    std::sync::Mutex::new(None);

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("已取消分享到 ADB".into());
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_adb_share() {
    if let Ok(active) = ACTIVE_SHARE_CANCEL.lock() {
        if let Some(cancel) = active.as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
}

fn share(
    settings: AdbSettings,
    format: String,
    name: String,
    data: Vec<u8>,
    cancel: &AtomicBool,
    progress: impl Fn(&str),
) -> Result<String, String> {
    let target = SkinTarget::of(&settings.package);
    if data.is_empty() || data.len() > 64 * 1024 * 1024 {
        return Err("无效的 Android 皮肤包（最大 64 MB）".into());
    }
    if !target.formats().contains(&format.as_str()) {
        return Err(format!(
            "{}只接受 {} 皮肤包，请改用对应格式导出",
            target.name(),
            target.formats().join(" / ").to_uppercase()
        ));
    }
    if !valid_skin_name(&name, &format) {
        return Err("皮肤文件名无效，请使用不含路径的皮肤文件名".into());
    }
    let serial = connect(&settings)?;
    let adb = |args: &[&str]| {
        ensure_not_cancelled(cancel)?;
        let mut all = vec!["-s", serial.as_str()];
        all.extend_from_slice(args);
        run_adb(&settings.executable, &all)
    };
    let selected = adb(&["shell", "settings", "get", "secure", "default_input_method"])?;
    if selected.trim().split('/').next() != Some(settings.package.as_str()) {
        return Err(format!(
            "请先在设备的系统输入法设置中将{}设为当前输入法，再重新分享；未更改设备默认输入法",
            target.name()
        ));
    }
    // 留空时用该输入法自己的入口；自定义包名才退回按包名解析。
    let import_activity = if settings.activity.is_empty() {
        target.import_activity().unwrap_or_default()
    } else {
        settings.activity.as_str()
    };
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = std::env::temp_dir().join(format!("keyskin-adb-{}-{id}", std::process::id()));
    fs::create_dir(&temporary).map_err(|e| e.to_string())?;
    let local = temporary.join(&name);
    let directory = skin_directory(&settings);
    let remote = format!("{directory}/{name}");
    let result = (|| {
        fs::write(&local, data).map_err(|e| e.to_string())?;
        adb(&["shell", "mkdir", "-p", &directory])?;
        adb(&["push", local.to_str().ok_or("临时文件路径无效")?, &remote])?;
        progress(&format!(
            "皮肤已推送，正在启动{}导入；若设备弹出提示，请先在设备端处理",
            target.name()
        ));
        // 搜狗只扫描 wallpaper 目录得到本地皮肤，再在「我的皮肤」里启用。
        if target == SkinTarget::Sogou {
            open_sogou_skins(&adb, &settings.package)
                .map_err(|e| format!("皮肤已推送到 {remote}，但{e}"))?;
        } else {
            // ACTION_VIEW 与 Android 客户端的分享入口一致；仅传递校验过的参数，绝不执行自定义 shell。
            let uri = device_file_uri(&remote);
            let mut args = vec![
                "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", uri.as_str(),
                "-t", target.mime_type(), "-f", "0x10008000",
            ];
            // exhibit 会打开「今日推荐」广告页；ask=false 让导入直接启用皮肤。
            if target == SkinTarget::Baidu {
                args.extend(["--ez", "exhibit", "false", "--ez", "ask", "false"]);
            }
            let component;
            if import_activity.is_empty() {
                args.extend(["-p", &settings.package]);
            } else {
                component = format!("{}/{import_activity}", settings.package);
                args.extend(["-n", &component]);
            }
            adb(&args).map_err(|e| format!(
                "皮肤已推送到 {remote}，但启动{}导入失败：{e}。请检查包名、Activity 和输入法文件访问权限",
                target.name()
            ))?;
        }
        // 百度导入成功即启用新皮肤：等导入页退出后直接调起键盘确认效果。
        if target == SkinTarget::Baidu {
            progress(&format!(
                "等待{}完成导入；请在设备上查看兼容性或权限提示",
                target.name()
            ));
            let started = Instant::now();
            loop {
                // 兼容性/权限提示会挡住导入页，点掉后再等它退出。
                if let Ok(xml) = dump_ui(&adb) {
                    for label in ["确定", "继续"] {
                        if let Some((x, y)) = ui_bounds_for_label(&xml, label) {
                            adb(&["shell", "input", "tap", &x.to_string(), &y.to_string()])?;
                            break;
                        }
                    }
                }
                let activities = adb(&["shell", "dumpsys", "activity", "activities"])?;
                let importing = activities
                    .lines()
                    .filter(|line| {
                        line.contains("topResumedActivity") || line.contains("mResumedActivity")
                    })
                    .any(|line| {
                        line.contains(&settings.package)
                            && (import_activity.is_empty() || line.contains(import_activity))
                    });
                if !importing {
                    break;
                }
                if started.elapsed() > Duration::from_secs(45) {
                    return Err(format!(
                        "皮肤已推送，{}仍停留在导入页；请在设备上处理兼容性/权限提示后重新分享",
                        target.name()
                    ));
                }
                std::thread::sleep(Duration::from_millis(300));
            }
        }
        if target == SkinTarget::Sogou {
            progress("正在搜狗「我的皮肤」里启用刚推送的皮肤…");
            apply_sogou_skin(&adb)?;
        } else if target == SkinTarget::ShouXin {
            progress("等待手心确认导入并应用…");
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(15) {
                if tap_ui_text(&adb, "确定")? {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
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
    let cancel = std::sync::Arc::new(AtomicBool::new(false));
    if let Ok(mut active) = ACTIVE_SHARE_CANCEL.lock() {
        *active = Some(cancel.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        share(settings, format, name, data, &cancel, |detail| {
            let _ = progress.send(detail.to_owned());
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Ok(mut active) = ACTIVE_SHARE_CANCEL.lock() {
        *active = None;
    }
    result
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
            host: String::new(),
            port: String::new(),
        }
    }

    #[test]
    fn targets_own_their_format_entry_and_directory() {
        assert_eq!(SkinTarget::of("com.baidu.input_mi").name(), "百度输入法");
        assert_eq!(
            SkinTarget::of("com.sohu.inputmethod.sogou.chuizi").name(),
            "搜狗输入法"
        );
        assert_eq!(SkinTarget::of("com.xinshuru.inputmethod").name(), "手心输入法");
        assert_eq!(SkinTarget::of("com.example.ime").name(), "输入法");
        assert_eq!(SkinTarget::of("com.sohu.inputmethod.sogou").formats(), ["ssf"]);
        assert_eq!(SkinTarget::of("com.baidu.input").formats(), ["bds", "bda"]);
        assert_eq!(
            SkinTarget::of("com.sohu.inputmethod.sogou").import_activity(),
            None
        );
        assert_eq!(
            SkinTarget::of("com.xinshuru.inputmethod").import_activity(),
            Some(".FTInputSettingsActivity")
        );
        assert_eq!(SkinTarget::of("com.baidu.input").mime_type(), "application/octet-stream");
        assert_eq!(SkinTarget::of("com.sohu.inputmethod.sogou").mime_type(), "'*/*'");
        assert_eq!(
            skin_directory(&AdbSettings {
                directory: String::new(),
                ..settings()
            }),
            "/sdcard/Android/data/com.baidu.input/files/KeySkin"
        );
        assert_eq!(
            skin_directory(&AdbSettings {
                directory: String::new(),
                package: "com.sohu.inputmethod.sogou".into(),
                ..settings()
            }),
            "/sdcard/Android/data/com.sohu.inputmethod.sogou/files/sga/wallpaper"
        );
        assert_eq!(
            skin_directory(&AdbSettings {
                directory: "/sdcard/Download/Skin/".into(),
                ..settings()
            }),
            "/sdcard/Download/Skin"
        );
    }

    #[test]
    fn share_rejects_formats_the_target_cannot_install() {
        let sogou = AdbSettings {
            package: "com.sohu.inputmethod.sogou".into(),
            ..settings()
        };
        assert!(share(sogou, "bds".into(), "a.bds".into(), vec![1], &AtomicBool::new(false), |_| {})
            .unwrap_err()
            .contains("SSF"));
        // SXI is a supported hand-heart import format.
        assert!(share(settings(), "ssf".into(), "a.ssf".into(), vec![1], &AtomicBool::new(false), |_| {})
            .unwrap_err()
            .contains("BDS / BDA"));
    }

    #[cfg(unix)]
    #[test]
    fn sogou_share_starts_its_own_import_entry_with_wildcard_mime() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!(
            "keyskin-sogou-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let executable = root.join("adb");
        let calls = root.join("calls");
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\necho \"$@\" >> '{}'\ncase \"$1\" in\ndevices) printf 'dev\\tdevice\\n';;\n-s) case \"$4\" in pm) echo package:/sogou.apk;; settings) echo com.sohu.inputmethod.sogou/.SogouIME;; dumpsys) echo 'mCurId=com.sohu.inputmethod.sogou/.SogouIME mBoundToMethod=true mInputShown=true';; uiautomator) echo 'UI hierchary dumped to: /sdcard/keyskin-window.xml';; cat) echo '<hierarchy><node class=\"android.widget.ImageView\" clickable=\"true\" bounds=\"[0,0][100,100]\"/><node text=\"(本地)\" bounds=\"[0,100][100,200]\"/><node text=\"立即启用\" bounds=\"[0,200][100,300]\"/><node class=\"android.widget.EditText\" bounds=\"[0,300][100,400]\"/></hierarchy>';; esac;;\nesac\n",
                calls.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let config = AdbSettings {
            executable: executable.to_str().unwrap().into(),
            directory: String::new(),
            package: "com.sohu.inputmethod.sogou".into(),
            ..settings()
        };
        assert_eq!(
            share(config, "ssf".into(), "测试.ssf".into(), vec![1], &AtomicBool::new(false), |_| {}).unwrap(),
            "dev"
        );
        let written = fs::read_to_string(&calls).unwrap();
        assert!(written.contains("push"));
        assert!(written.contains(
            "-n com.sohu.inputmethod.sogou/com.sogou.inputmethod.navigation.UniRouteActivity"
        ));
        assert!(written.contains("sogou://com.sogou.sogouinput/mine-my-skins"));
        assert!(written.contains("/sdcard/Android/data/com.sohu.inputmethod.sogou/files/sga/wallpaper"));
        assert!(!written.contains("exhibit"));
        fs::remove_dir_all(root).unwrap();
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
        write("case \"$1\" in\nconnect) echo \"connected to $2\";;\ndevices) printf 'other-device\\tdevice\\n127.0.0.1:12345\\tdevice\\n';;\n-s) test \"$2\" = '127.0.0.1:12345' || exit 1; case \"$4\" in pm) echo package:/test.apk;; settings) echo com.baidu.input/.ImeService;; dumpsys) echo 'mCurId=com.baidu.input/.ImeService mBoundToMethod=true mInputShown=true';; uiautomator) echo 'UI hierarchy dumped to: /data/local/tmp/keyskin-window.xml';; cat) printf '%s' '<hierarchy><node resource-id=\"com.baidu.input:id/recycler_view\" bounds=\"[0,0][1080,1800]\"><node class=\"android.view.ViewGroup\" clickable=\"true\" bounds=\"[0,100][500,500]\"><node resource-id=\"com.baidu.input:id/skin_name\" text=\"测试 皮肤\" bounds=\"[0,100][500,150]\"/><node resource-id=\"com.baidu.input:id/tag_in_use\" text=\"已启用\" bounds=\"[0,150][500,200]\"/></node></node><node class=\"android.widget.EditText\" bounds=\"[0,0][100,100]\"/></hierarchy>';; esac;;\npair) test \"$#\" -eq 2 || exit 1; read -r code; test \"${#code}\" -eq 6 || exit 1; echo \"Successfully paired to $2\";;\nesac");
        assert_eq!(connect(&config).unwrap(), "127.0.0.1:12345");
        let messages = std::cell::RefCell::new(Vec::new());
        assert!(share(
            config.clone(),
            "bds".into(),
            "测试 皮肤.bds".into(),
            vec![1],
            &AtomicBool::new(false),
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
        write("case \"$1\" in connect) echo \"connected to $2\";; devices) printf '127.0.0.1:12345\\tdevice\\n';; -s) case \"$4\" in pm) echo package:/test.apk;; settings) echo com.other/.ImeService;; *) exit 1;; esac;; esac");
        assert!(share(
            config.clone(),
            "bds".into(),
            "test.bds".into(),
            vec![1],
            &AtomicBool::new(false),
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

    #[test]
    fn sogou_local_card_bounds_use_the_nearest_clickable_preview() {
        let xml = r#"<hierarchy>
            <node class="android.widget.ImageView" clickable="true" bounds="[10,20][110,220]" />
            <node text="测试皮肤" bounds="[10,220][110,260]" />
            <node text="(本地)" bounds="[110,220][180,260]" />
        </hierarchy>"#;
        assert_eq!(ui_bounds_for_label(xml, "立即启用"), None);
        assert_eq!(ui_bounds_for_local_card(xml), Some((60, 120)));
    }

    #[test]
    fn cancel_request_stops_before_the_next_adb_call() {
        let cancel = AtomicBool::new(true);
        assert!(ensure_not_cancelled(&cancel).unwrap_err().contains("已取消"));
        assert!(ensure_not_cancelled(&AtomicBool::new(false)).is_ok());
        // 取消命令只置位当前这一次分享的开关。
        let active = std::sync::Arc::new(AtomicBool::new(false));
        *ACTIVE_SHARE_CANCEL.lock().unwrap() = Some(active.clone());
        cancel_adb_share();
        assert!(active.load(Ordering::SeqCst));
        *ACTIVE_SHARE_CANCEL.lock().unwrap() = None;
    }

    #[cfg(unix)]
    #[test]
    fn share_stops_after_the_running_step_when_cancel_is_requested() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!(
            "keyskin-cancel-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let executable = root.join("adb");
        let calls = root.join("calls");
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\necho \"$@\" >> '{}'\ncase \"$1\" in\ndevices) printf 'dev\\tdevice\\n';;\n-s) case \"$3\" in\npush) echo pushed;;\nshell) case \"$4\" in\npm) echo package:/x.apk;;\nsettings) echo com.baidu.input/.ImeService;;\nesac;;\nesac;;\nesac\n",
                calls.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let config = AdbSettings {
            executable: executable.to_str().unwrap().into(),
            package: "com.baidu.input".into(),
            ..settings()
        };
        let cancel = AtomicBool::new(false);
        let error = share(config, "bds".into(), "测试.bds".into(), vec![1], &cancel, |detail| {
            if detail.contains("皮肤已推送") {
                cancel.store(true, Ordering::SeqCst);
            }
        })
        .unwrap_err();
        assert!(error.contains("已取消"), "{error}");
        let written = fs::read_to_string(&calls).unwrap();
        assert!(written.contains("push"));
        assert!(!written.contains("am start"), "取消后不再启动导入: {written}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn settings_deserialize_the_payload_the_webview_sends() {
        let settings: AdbSettings = serde_json::from_str(
            r#"{"executable":"adb","serial":"","directory":"","package":"com.sohu.inputmethod.sogou","activity":"","host":"","port":""}"#,
        )
        .unwrap();
        assert_eq!(settings.executable, "adb");
        assert_eq!(settings.package, "com.sohu.inputmethod.sogou");
    }

    #[test]
    fn ui_dump_path_accepts_both_android_messages() {
        assert_eq!(
            ui_dump_path("UI hierchary dumped to: /sdcard/keyskin-window.xml"),
            Some("/sdcard/keyskin-window.xml")
        );
        assert_eq!(
            ui_dump_path("UI hierarchy dumped to: /data/local/tmp/keyskin-window.xml"),
            Some("/data/local/tmp/keyskin-window.xml")
        );
    }
}
