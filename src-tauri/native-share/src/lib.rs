use tauri::{plugin::TauriPlugin, Runtime};

#[cfg(target_os = "android")]
use tauri::{ipc::Channel, plugin::PluginHandle, AppHandle, Manager};

#[cfg(target_os = "android")]
struct NativeShare<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareFilePayload {
    path: String,
    name: String,
    mime_type: String,
}

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservePayload {
    uri: String,
    handler: Channel<String>,
}

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
struct WorkspacePayload {
    uri: String,
}

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
struct CreateWorkspacePayload {
    uri: String,
    name: String,
    files: serde_json::Value,
}

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
struct ApplyChangesPayload {
    uri: String,
    changes: serde_json::Value,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new("native-share");
    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        let handle =
            api.register_android_plugin("io.github.rekazer0.keyskin.share", "SharePlugin")?;
        app.manage(NativeShare(handle));
        Ok(())
    });
    builder.build()
}

#[cfg(target_os = "android")]
pub fn share_file<R: Runtime>(
    app: &AppHandle<R>,
    path: String,
    name: String,
    mime_type: String,
) -> Result<(), String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin::<()>(
            "shareFile",
            ShareFilePayload {
                path,
                name,
                mime_type,
            },
        )
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub fn pick_source_directory<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin("pickSourceDirectory", ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub async fn choose_project_template<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin_async("chooseProjectTemplate", ())
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub fn start_source_observer<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
    handler: Channel<String>,
) -> Result<(), String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin::<()>("startSourceObserver", ObservePayload { uri, handler })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub fn stop_source_observer<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin::<()>("stopSourceObserver", ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub async fn create_source_workspace<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
    name: String,
    files: serde_json::Value,
) -> Result<String, String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin_async(
            "createSourceWorkspace",
            CreateWorkspacePayload { uri, name, files },
        )
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub async fn read_source_workspace<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
) -> Result<serde_json::Value, String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin_async("readSourceWorkspace", WorkspacePayload { uri })
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub async fn read_source_workspace_archive<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
) -> Result<String, String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin_async("readSourceWorkspaceArchive", WorkspacePayload { uri })
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
pub async fn apply_source_changes<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
    changes: serde_json::Value,
) -> Result<(), String> {
    app.state::<NativeShare<R>>()
        .0
        .run_mobile_plugin_async::<()>("applySourceChanges", ApplyChangesPayload { uri, changes })
        .await
        .map_err(|error| error.to_string())
}
