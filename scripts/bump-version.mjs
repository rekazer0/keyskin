import { readFileSync, writeFileSync } from "node:fs"

const read = (path) => readFileSync(path, "utf8")
const write = (path, value) => writeFileSync(path, value)
const packageJson = JSON.parse(read("package.json"))
const previous = packageJson.version
const [major, minor, patch] = previous.split(".").map(Number)
const mode = process.argv[2] ?? "bugfix"
const next = mode === "feature"
  ? `${major}.${minor + 1}.0`
  : mode === "bugfix"
    ? `${major}.${minor}.${patch + 1}`
    : mode

if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error("用法：bump-version.mjs feature|bugfix|x.y.z")

packageJson.version = next
write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`)

const packageLock = JSON.parse(read("package-lock.json"))
packageLock.version = next
packageLock.packages[""].version = next
write("package-lock.json", `${JSON.stringify(packageLock, null, 2)}\n`)

for (const path of [
  "index.html",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.windows.conf.json",
]) {
  write(path, read(path).replaceAll(previous, next).replaceAll(previous.replaceAll(".", "\\."), next.replaceAll(".", "\\.")))
}

write("README.md", read("README.md").replace(`## v${previous} 更新`, `## v${next} 更新`))
write("src-tauri/Cargo.toml", read("src-tauri/Cargo.toml").replace(/^(version = ")[^"]+("$)/m, `$1${next}$2`))
write(
  "src-tauri/Cargo.lock",
  read("src-tauri/Cargo.lock").replace(/(\[\[package\]\]\nname = "keyskin"\nversion = ")[^"]+/, `$1${next}`),
)

console.log(`${previous} -> ${next}`)
