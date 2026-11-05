fn main() {
    tauri_plugin::Builder::new(&[
        "pickSourceDirectory",
        "pickSkinFile",
        "chooseProjectTemplate",
        "createSourceWorkspace",
        "readSourceWorkspace",
        "applySourceChanges",
        "startSourceObserver",
        "stopSourceObserver",
    ])
    .android_path("android")
    .build();
}
