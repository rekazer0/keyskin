import { strToU8, zipSync } from "fflate"
import { encodePng } from "../../src/ssf/ssf-png.ts"

// 与 Pen 的示例同色，仅供视觉验收，不替换产品中的用户皮肤。
export function mobilePenFixture() {
  const image = (color) => {
    const data = new Uint8Array(72 * 72 * 4)
    for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) {
      const dx = Math.max(8 - x, x - 63, 0), dy = Math.max(8 - y, y - 63, 0)
      data.set([...color, dx * dx + dy * dy <= 64 ? 255 : 0], (y * 72 + x) * 4)
    }
    return encodePng({ width: 72, height: 72, data })
  }
  const layout = ["[PANEL]", "SIZE=1080,600", "KEY_NUM=33", "BACK_STYLE=1"]
  const styles = ["[GLOBAL]", "STYLE_NUM=100", "[STYLE1]", "NM_COLOR=FFDCDDEB", "[STYLE2]", "NM_IMG=key_matte,1", "HL_IMG=key_tint,1", "[STYLE4]", "PRESS_ANIM=1"]
  let number = 0
  const rows = ["QWERTYUIOP".split(""), "ASDFGHJKL".split(""), ["⇧", ..."ZXCVBNM", "⌫"], ["123", "符", "空格", "中文", "↵"]]
  rows.forEach((keys, row) => {
    const gap = 12, width = (1040 - gap * (keys.length - 1)) / keys.length
    keys.forEach((key, col) => {
      number++
      layout.push(`[KEY${number}]`, `VIEW_RECT=${Math.round(20 + col * (width + gap))},${20 + row * 144},${Math.round(width)},128`, "BACK_STYLE=2", `FORE_STYLE=${30 + number}`, "ANIM_STYLE=4", `CENTER=${key}`)
      styles.push(`[STYLE${30 + number}]`, `SHOW=${key}`, "FONT_SIZE=36", "NM_COLOR=FF41445A", "HL_COLOR=FF6554D9")
    })
  })
  styles.push("[STYLE100]", "NM_IMG=key_tint,1", "HL_IMG=key_matte,1")
  const files = {
    "Info.txt": "Name=雾紫\nAuthor=KeySkin\nSupportDarkMode=0\n",
    "light/port/gen.ini": "[PANEL]\nSIZE=1080,600\n[CAND]\nLAYOUT_NAME=cand1\n",
    "light/port/py_26.ini": layout.join("\n"),
    "light/port/cand1.cnd": "[CAND]\nVIEW_RECT=0,0,1080,100\nBACK_STYLE=1\nCELL_STYLE=3\n[STYLE3]\nFONT_SIZE=36\n",
    "light/res/default.css": styles.join("\n"),
    "light/res/anim.ini": "[ANIM1]\nCATEGORY=0\nTYPE=1\nDURATION=180\nFROM=0.9\nTO=1\n",
    "light/res/key_matte.til": "[IMG1]\nSOURCE_RECT=0,0,72,72\nINNER_RECT=8,8,56,56\n",
    "light/res/key_tint.til": "[IMG1]\nSOURCE_RECT=0,0,72,72\nINNER_RECT=8,8,56,56\n",
  }
  return zipSync({ ...Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace("light/", "light/skin/"), strToU8(text)])),
    "light/skin/res/key_matte.png": image([247, 247, 252]), "light/skin/res/key_tint.png": image([182, 175, 228]) })
}
