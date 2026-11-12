fn main() {
    // 图标由 generate_context! 缓存在 OUT_DIR，更新原图时也必须重新生成。
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
