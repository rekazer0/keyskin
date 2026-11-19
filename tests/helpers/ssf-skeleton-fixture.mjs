// 搜狗手机皮肤的官方骨架：只含面板尺寸、主键盘按键几何与样式文件，供 SSF 转换测试使用。
// 结构与百度 BDS 一致（只是多一层 skin 目录），这样骨架可以直接被 BDS 转换器解析。
import { strToU8, zipSync } from "fflate"

export function ssfSkeletonFixture() {
  return zipSync({
    "light/skin/port/gen.ini": strToU8("[PANEL]\nSIZE=1080,846\n"),
    "light/skin/port/py_26.ini": strToU8([
      "[PANEL]", "SIZE=1080,846", "KEY_NUM=3",
      "[KEY1]", "VIEW_RECT=0,0,360,282", "CENTER=q",
      "[KEY2]", "VIEW_RECT=360,0,360,282", "CENTER=w",
      "[KEY3]", "VIEW_RECT=720,0,360,282", "CENTER=F1",
    ].join("\n")),
    "light/skin/res/default.css": strToU8("[STYLE1]\nNM_COLOR=FF000000\n"),
  })
}
