import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { mobilePenFixture } from './mobile-pen-fixture.mjs'
import { decodePng, encodePng } from '../../src/ssf/ssf-png.ts'
import { wav } from './ssf-fixture.mjs'

// 验收专用的真实皮肤：用同一渲染/修改/导出链路展示 Figma 的轻雾配色。
export function mobileFigmaFixture() {
  const files = unzipSync(mobilePenFixture())
  const text = (path, value) => { files[`light/skin/${path}`] = strToU8(value) }
  for (const [name, rgb] of [['key_matte', [249,251,247]], ['key_tint', [182,200,174]]]) {
    const path = `light/skin/res/${name}.png`
    const image = decodePng(files[path])
    for (let i=0;i<image.data.length;i+=4) image.data.set(rgb,i)
    files[path] = encodePng(image)
  }
  let css = strFromU8(files['light/skin/res/default.css']).replaceAll('FFDCDDEB', 'FFDDE5D9').replaceAll('FF41445A', 'FF273527').replaceAll('FF6554D9', 'FF273527')
  css += ['分词','ABC','DEF','GHI','JKL','MNO','PQRS','TUV','WXYZ','123','空格','↵'].map((k,i)=>`\n[STYLE${131+i}]\nSHOW=${k}\nFONT_SIZE=36\nNM_COLOR=FF273527\n`).join('')
  text('res/default.css', css + '\n[STYLE5]\nPRESS_ANIM=2\n')
  text('res/default.css', strFromU8(files['light/skin/res/default.css']) + '\n[STYLE3]\nFONT_SIZE=36\nNM_COLOR=FF273527\n')
  text('port/cand1.cnd', '[CAND]\nVIEW_RECT=0,0,1080,100\nBACK_STYLE=1\nFORE_STYLE=3\nINPUT_STYLE=3\n')
  text('port/py_9.ini', '[PANEL]\nSIZE=1080,600\nBACK_STYLE=1\nKEY_NUM=12\n' + ['分词','ABC','DEF','GHI','JKL','MNO','PQRS','TUV','WXYZ','123','空格','↵'].map((k,i)=>`[KEY${i+1}]\nVIEW_RECT=${20+i%3*350},${20+Math.floor(i/3)*144},338,128\nBACK_STYLE=2\nCENTER=${k}\nFORE_STYLE=${131+i}\n`).join(''))
  text('res/anim.ini', '[ANIM1]\nINFO=轻触回弹\nCATEGORY=0\nTYPE=3\nDURATION=240\nFROM=0.96\nTO=1\n[ANIM2]\nINFO=轻盈散开\nCATEGORY=3\nTYPE=0\nDURATION=240\nLIFE=240,240\nTOTAL_NUMBER=8\nBIRTH_RATE=8\nPARTICLE_IMAGE=2\nINIT_ALPHA=0.6\nINIT_SIZE=16\n')
  text('port/py_26.ini', strFromU8(files['light/skin/port/py_26.ini']).replace('CENTER=A','CENTER=A\nSOUND_STYLE=6'))
  text('res/default.css', strFromU8(files['light/skin/res/default.css'])+'\n[STYLE6]\nNM_SOUND=key_click.wav\n')
  files['light/skin/res/key_click.wav'] = wav()
  files['Info.txt'] = strToU8('Name=轻雾\nAuthor=KeySkin 示例\nVersion=1.0.0\nDescription=一点留白，一点自然\n')
  return zipSync(files)
}
