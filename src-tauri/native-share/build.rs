fn main() {
    tauri_plugin::Builder::new(&[
        "pickSourceDirectory",
        "pickSkinFile",
        "createSourceWorkspace",
        "readSourceWorkspace",
        "applySourceChanges",
        "startSourceObserver",
        "stopSourceObserver",
    ])
    .android_path("android")
    .build();
}
