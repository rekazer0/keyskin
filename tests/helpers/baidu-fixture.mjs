// A small complete Baidu BDS skin built in code, so SXI conversion tests need no third-party skin.
import { strToU8, zipSync } from "fflate"
import { encodePng } from "../../src/ssf/ssf-png.ts"

const PNG = (width, height) => encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(0x80) })

function fixtureFiles() {
  return {
    "Info.txt": strToU8("Name=测试皮肤\nAuthor=me\nSupportDarkMode=1\n"),
    "light/port/gen.ini": strToU8([
      "[PANEL]", "SIZE=1080,600", "BACK_STYLE=1",
      "[CAND]", "LAYOUT_NAME=cand1",
      "[HINT]", "LAYOUT_NAME=hint1",
      "[MORE]", "LAYOUT_NAME=sel_ch", "SYM_LAYOUT=symbol",
      "[LIST]", "CELL_STYLE=120", "FORE_STYLE=3", "PADDING=0,0,0,0", "CELL_SIZE=100,50",
      "NAMES=， 。 ？", "VALUES=， 。 ？",
    ].join("\n")),
    "light/port/py_26.ini": strToU8([
      "[PANEL]", "SIZE=1080,600", "NO_BLUR=1", "KEY_NUM=2",
      "[KEY1]", "BACK_STYLE=2", "FORE_STYLE=3,4", "POS_TYPE=0,5", "VIEW_RECT=10,0,100,120", "CENTER=q", "UP=F38", "STAT_STYLE=S11_4",
      "[KEY2]", "BACK_STYLE=2", "VIEW_RECT=120,0,100,120", "CENTER=F1",
      "[TIP4]", "BACK_STYLE=2", "CENTER=F38",
    ].join("\n")),
    "light/port/py_9.ini": strToU8([
      "[PANEL]", "SIZE=1080,600", "KEY_NUM=2",
      "[KEY1]", "BACK_STYLE=2", "VIEW_RECT=0,0,300,200", "CENTER=F36",
      "[KEY2]", "BACK_STYLE=2", "VIEW_RECT=300,0,300,200", "CENTER=F37",
    ].join("\n")),
    "light/port/cand1.cnd": strToU8("[CAND]\nBACK_STYLE=6\nVIEW_RECT=0,0,1080,120\nPADDING=1,2,3,4\nCELL_STYLE=120\n[ICON1]\nPOS=0,0\nSIZE=10,10\nKEY=F31\n"),
    "light/port/hint1.pop": strToU8("[HINT]\nBACK_ICON=0\n[ICON0]\nPOS=1,2\nSIZE=3,4\n"),
    "light/port/sel_ch.ini": strToU8("[PANEL]\nSIZE=1080,600\n[KEY1]\nBACK_STYLE=2\nVIEW_RECT=0,0,100,100\nCENTER=F36\n"),
    "light/res/default.css": strToU8([
      "[STYLE1]", "NM_COLOR=FF000000",
      "[STYLE2]", "NM_IMG=btn,0", "HL_IMG=btn,1", "PRESS_SOUND_PATH=click.wav",
      "[STYLE3]", "SHOW=中", "FONT_SIZE=40", "NM_COLOR=FF000000",
      "[STYLE4]", "NM_COLOR=FF000000",
      "[STYLE6]", "NM_IMG=bg,0",
      "[STYLE120]", "NM_IMG=list_cell,1", "HL_IMG=list_cell,0",
    ].join("\n")),
    "light/res/anim.ini": strToU8("[ANIM1]\nCATEGORY=0\nTYPE=1\nDURATION=200\nFROM=0\nTO=1\n"),
    "light/res/btn.til": strToU8("[IMG0]\nSOURCE_RECT=0,0,10,10\nINNER_RECT=2,2,6,6\n[IMG1]\nSOURCE_RECT=10,0,10,10\n"),
    "light/res/bg.til": strToU8("[IMG0]\nSOURCE_RECT=0,0,10,10\n"),
    "light/res/list_cell.til": strToU8("[IMG0]\nSOURCE_RECT=0,0,4,4\n[IMG1]\nSOURCE_RECT=4,0,4,4\n"),
    "light/res/btn.png": PNG(20, 10),
    "light/res/bg.png": PNG(10, 10),
    "light/res/list_cell.png": PNG(8, 4),
  }
}

export function bdsFixture() {
  return zipSync(fixtureFiles())
}
