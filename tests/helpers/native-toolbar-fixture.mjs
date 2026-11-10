import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../../src/skin.ts'
import { plist, toolbarMenuItem } from '../../src/ios-toolbar.ts'
import { encodePng } from '../../src/ssf/ssf-png.ts'

const solid = (width, height, rgba) => encodePng({ width, height,
  data: Uint8Array.from({ length: width * height * 4 }, (_, i) => rgba[i % 4]) })

export function nativeToolbarFixture(format = 'bdi') {
  const files = { 'Info.txt': 'Name=Native toolbar height\n' }
  for (const theme of ['light', 'dark']) {
    const root = format === 'bdi' ? `skin/${theme}/skin/` : `${theme}/`
    files[`${root}res/default.css`] = '[STYLE1]\nNM_IMG=bar,1\n[STYLE2]\nNM_IMG=edge,1\nHL_IMG=edge,2\n[STYLE3]\nNM_COLOR=202020\nFONT_SIZE=43\n[STYLE4]\nNM_IMG=input,1\n'
    files[`${root}res/bar.png`] = solid(1125, 90, [255, 255, 255, 255])
    files[`${root}res/bar.til`] = '[IMG1]\nSOURCE_RECT=0,0,1125,90\nINNER_RECT=270,22,550,1\n'
    files[`${root}res/edge.png`] = solid(136, 220, [80, 150, 100, 255])
    files[`${root}res/edge.til`] = '[IMG1]\nSOURCE_RECT=0,0,136,110\n[IMG2]\nSOURCE_RECT=0,110,136,110\n'
    files[`${root}res/input.png`] = solid(1125, 30, [210, 230, 210, 255])
    files[`${root}res/input.til`] = '[IMG1]\nSOURCE_RECT=0,0,1125,30\n'
    files[`${root}res/logo/function_iphone@3x.png`] = solid(80, 80, [50, 150, 80, 255])
    files[`${root}res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`] = plist([
      toolbarMenuItem('17', '键盘类型', 'toolbar', 'function', 'function'),
    ])
    for (const orientation of ['port', 'land']) {
      files[`${root}${orientation}/gen.ini`] = '[PANEL]\nSIZE=1125,592\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,1125,124\n[INPUT]\nFORE_STYLE=3\n[SCAND]\nBACK_STYLE=4\nINPUT_STYLE=3\n[LOGO]\nLAYOUT_NAME=logo\n'
      files[`${root}${orientation}/py_26.ini`] = '[PANEL]\nKEY_NUM=1\n[KEY1]\nVIEW_RECT=0,0,125,144\nCENTER=q\n'
      files[`${root}${orientation}/cand1.cnd`] = '[CAND]\nBACK_STYLE=1\nCELL_W=62\n[ICON1]\nSIZE=229,186\nPOS=0,20\nANCHOR_TYPE=1\nFIX_SIZE=50,52\nFORE_STYLE=2\nKEY=F31\n[ICON2]\nSIZE=229,186\nPOS=-229,0\nANCHOR_TYPE=3\nFIX_SIZE=50,52\nFORE_STYLE=2\nKEY=F8\n[ICON3]\nSIZE=780,58\nPOS=-390,43\nANCHOR_TYPE=2\nKEY=F14\n[ICON4]\nSIZE=700,60\nPOS=-1500,-30\nANCHOR_TYPE=5\nKEY=F14\n'
    }
  }
  return SkinArchive.open(zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) =>
    [path, typeof value === 'string' ? strToU8(value) : value]))), format)
}
