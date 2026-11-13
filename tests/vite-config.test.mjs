import assert from "node:assert/strict"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createServer, resolveConfig } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const configFile = join(root, "vite.config.ts")

test("worktrees keep Vite caches outside shared dependencies", async () => {
  const otherRoot = join(root, ".tmp", "other-worktree")
  const config = await resolveConfig({ root, configFile }, "serve")
  const other = await resolveConfig({ root: otherRoot, configFile }, "serve")
  const dependencies = realpathSync(join(root, "node_modules"))
  assert.ok(relative(root, config.cacheDir).startsWith(".tmp/"))
  assert.ok(relative(otherRoot, other.cacheDir).startsWith(".tmp/"))
  assert.notEqual(config.cacheDir, other.cacheDir)
  assert.ok(relative(dependencies, config.cacheDir).startsWith(".."))
})

test("Vite serves linked dependency fonts while keeping other files private", async () => {
  const outside = mkdtempSync(join(tmpdir(), "keyskin-vite-"))
  const server = await createServer({ root, configFile, logLevel: "silent", server: { port: 0, hmr: false } })
  try {
    await server.listen()
    const base = `http://127.0.0.1:${server.httpServer.address().port}`
    const font = realpathSync(join(root, "node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"))
    const response = await fetch(`${base}/@fs${font}`)
    assert.equal(response.status, 200)
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString(), "wOF2")
    const privateFile = join(outside, "private.txt")
    writeFileSync(privateFile, "private")
    assert.equal((await fetch(`${base}/@fs${privateFile}`)).status, 403)
  } finally {
    await server.close()
    rmSync(outside, { recursive: true, force: true })
  }
})
