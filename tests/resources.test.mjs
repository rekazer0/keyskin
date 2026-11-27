import assert from "node:assert/strict"
import test from "node:test"
import { logoImageFolder, resourceImagePaths } from "../src/resources.ts"

test("logo folders separate direct images and keep descendants in their first-level folder", () => {
  const names = [
    "light/skin/res/logo/brand.png",
    "light/skin/res/logo/1.0/brand.png",
    "light/skin/res/logo/1.0/nested/icon.png",
    "light/skin/res/logo/notes.txt",
    "light/skin/res/logo-extra/icon.png",
    "light/skin/port/res/logo/port.png",
    "dark/skin/res/logo/dark.png",
  ]
  const folders = theme => resourceImagePaths(names, theme, "port").map(logoImageFolder).filter(Boolean)
  assert.deepEqual(folders("light").sort(), ["logo", "logo/1.0", "logo/1.0"])
  assert.deepEqual(folders("dark"), ["logo"])
})
