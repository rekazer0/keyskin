// 48 Figma screens, using the production editor and a real editable fixture.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mobileFigmaFixture } from '../tests/helpers/mobile-figma-fixture.mjs'
import { SkinArchive } from '../src/skin.ts'
import { createHash } from 'node:crypto'
const root = new URL('..', import.meta.url).pathname
const output = `${root}.ui-current/figma-mobile`
mkdirSync(output, {recursive:true})
const server=await createServer({root,logLevel:'error',server:{host:'127.0.0.1',port:41766,strictPort:false,hmr:false}})
await server.listen()
const browser=await chromium.launch()
const page=await browser.newPage({viewport:{width:390,height:766},isMobile:true,hasTouch:true,deviceScaleFactor:1})
const errors=[], captures=[], downloads=[]
page.on('pageerror',e=>errors.push(e.message))
await page.addInitScript(()=>{localStorage.setItem('onboarding-tour-v1','done');window.showSaveFilePicker=undefined})
const load = async()=>{
  await page.locator('#browser-open').setInputFiles({name:'轻雾.bdi',mimeType:'application/octet-stream',buffer:Buffer.from(mobileFigmaFixture())})
  await page.waitForFunction(()=>!document.querySelector('#open').disabled && !document.querySelector('.canvas-wrap').classList.contains('empty'))
  if(await page.locator('#file-operation-dialog[open]').count())await page.locator('#file-operation-close').click()
  await page.evaluate(async()=>{(await import('/src/app/canvas-interaction.ts')).setSimulatedComposition('nihao');(await import('/src/app/preview-render.ts')).refreshSimulationPreview()})
}
const capture=async(id, note='')=>{
  await page.evaluate(async()=>{
    if(document.activeElement?.id==='mobile-inspector-resize')document.activeElement.blur()
    await document.fonts.ready
    for(const a of document.getAnimations()) if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish()
    const {preview}=await import('/src/app/canvas-interaction.ts')
    if(preview.keys.length && preview.canvas.getBoundingClientRect().height)await preview.whenDrawn()
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
  })
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`screen ${id}: page overflow`)
  for(const dialog of await page.locator('dialog[open]').all()){
    const b=await dialog.boundingBox(); assert.ok(b.x>=-1 && b.y>=-1 && b.x+b.width<=391 && b.y+b.height<=767,`screen ${id}: dialog outside viewport ${JSON.stringify(b)}`)
  }
  await page.screenshot({path:`${output}/${id}.png`,animations:'disabled'})
  captures.push({id,note});console.log(`PASS ${id}`)
}
const closeDialog=async()=>{
  const dialog=page.locator('dialog[open]').last();
  if(await dialog.count()){
    if(await dialog.getAttribute('id')==='file-operation-dialog')await page.locator('#file-operation-close').click()
    else await dialog.evaluate(el=>el.dispatchEvent(new Event('cancel',{cancelable:true})))
    await dialog.waitFor({state:'hidden'})
  }
}
const select=async(sections=['KEY11'],path='light/skin/port/py_26.ini')=>{
  await page.evaluate(async({sections,path})=>{
    const {selectFile}=await import('/src/app/navigation.ts');selectFile(path)
    const {appState}=await import('/src/app/state.ts');appState.selectedKeySections=sections
    const {preview}=await import('/src/app/canvas-interaction.ts');preview.setSelected(sections)
    ;(await import('/src/app/key-inspector.ts')).populateKeyInspector()
    ;(await import('/src/app/mobile-layout.ts')).setMobilePane('inspector')
  },{sections,path})
}
const more=async(action)=>{
  await page.locator('#mobile-app-more > summary').click()
  await page.locator(action==='settings' ? '#mobile-app-more [data-app-dialog="settings"]' : `#mobile-app-more [data-mobile-action="${action}"]`).click()
}
const resource=async(kind)=>{
  await page.locator('#mobile-navigation [data-mobile-page="project"]').click()
  await page.locator(`.sidebar-overview [data-nav-mode="${kind}"]`).click()
}
const savedDownload=async(trigger,format)=>{
  const pending=page.waitForEvent('download',{timeout:60000});pending.catch(()=>{})
  await trigger()
  for(;;){
    await page.waitForFunction(()=>{
      const d=document.querySelector('#file-operation-dialog')
      return d.dataset.outcome==='success'||d.dataset.stage==='compatibility'||[...d.querySelectorAll('button')].some(b=>!b.disabled&&b.textContent.includes('下载'))
    })
    if(await page.locator('#file-operation-dialog').getAttribute('data-stage')==='compatibility')await page.getByRole('button',{name:'确认并继续',exact:true}).click()
    else if(await page.locator('#file-operation-dialog').getAttribute('data-outcome')==='success')break
    else await page.locator('#file-operation-dialog button').filter({hasText:'下载'}).click()
  }
  const file=await pending,bytes=readFileSync(await file.path())
  const archive=SkinArchive.open(bytes,file.suggestedFilename().split('.').pop())
  assert.equal(archive.format,format,'download has the requested format')
  assert.ok(archive.isText('light/skin/port/py_26.ini'),'download contains a real editable keyboard')
  downloads.push({filename:file.suggestedFilename(),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),format:archive.format})
}
try{
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#mobile-welcome-open').waitFor()
  await capture('01')
  await page.locator('#mobile-welcome-new').click();await capture('02');await closeDialog()
  await page.locator('#mobile-welcome-open').click();await capture('03');await closeDialog()
  await load();await select([]);await capture('04')
  await select();await capture('05')
  await page.locator('#mobile-property-tabs [data-mobile-category="typography"]').click();await capture('06')
  await page.locator('#mobile-property-tabs [data-mobile-category="actions"]').click();await capture('07')
  await select(['KEY11','KEY12','KEY13']);await capture('08')
  await page.locator('#mobile-navigation [data-mobile-page="project"]').click();await capture('09')
  await page.locator('[data-sidebar-view="source"]').click();await capture('10')
  await select();await more('mobile-source-view');await page.getByRole('button',{name:'返回属性',exact:true}).waitFor();await capture('11')
  await resource('style');await capture('12')
  await page.locator('#mobile-resource-tabs [data-mobile-resource="resource"]').click();await capture('13')
  await page.locator('#resource-gallery .ui-image-card').first().dblclick()
  await page.waitForFunction(()=>document.querySelector('#atlas-canvas').getBoundingClientRect().height>100)
  const atlasMapping=await page.evaluate(async()=>{
    const canvas=document.querySelector('#atlas-canvas'),box=canvas.getBoundingClientRect(),image=document.querySelector('#workspace-image')
    const point=(await import('/src/app/tile-editing.ts')).atlasPoint({clientX:box.x+box.width/2,clientY:box.y+box.height/2})
    return {x:point.x,y:point.y,width:image.naturalWidth,height:image.naturalHeight}
  })
  assert.ok(Math.abs(atlasMapping.x-atlasMapping.width/2)<0.01 && Math.abs(atlasMapping.y-atlasMapping.height/2)<0.01,'fitted atlas retains original image coordinates')
  await capture('14')
  await resource('sound');assert.equal(await page.locator('[data-mobile-resource="sound"]').getAttribute('aria-pressed'),'true');await page.locator('#resource-gallery [role="option"][data-sound-id]').first().click();await page.locator('.ui-sound-waveform[aria-label*="时长"]').waitFor();await capture('15')
  await select();await resource('motion');await capture('16')
  await select();await resource('particle');await capture('17')
  await select();await page.locator('#mobile-canvas-mode [data-mode-choice="preview"]').click()
  await page.locator('#simulated-output').fill('验收输入');await page.locator('#clear-simulation').click();assert.equal(await page.locator('#simulated-output').inputValue(),'')
  const previewBounds=await page.locator('#preview').boundingBox();assert.ok(previewBounds.height>80 && previewBounds.y+previewBounds.height<710,'preview keyboard remains visible below simulation')
  await capture('18')
  await page.locator('.mobile-preview-return').click();await page.locator('.mobile-canvas-options').click();await capture('19');await closeDialog()
  await page.locator('#mobile-app-more > summary').click();await capture('20');await page.locator('#mobile-app-more > summary').click()
  await more('mobile-export-open');await capture('21');await closeDialog()
  await more('panel-scale');await capture('25')
  const copiedSource=await page.locator('#panel-copy-source').inputValue(),copiedTarget=await page.locator('#panel-copy-target').inputValue()
  const copyBefore=await page.evaluate(async source=>{const {appState}=await import('/src/app/state.ts');return {depth:appState.undoStack.length,bytes:[...appState.archive.getBytes(source)]}},copiedSource)
  await page.locator('#mobile-panel-scale-mode').selectOption('scale');assert.equal(await page.locator('#panel-scale-enabled').isChecked(),true)
  await page.locator('#mobile-panel-scale-mode').selectOption('original');assert.equal(await page.locator('#panel-scale-options').isHidden(),true)
  await page.locator('#panel-scale-form button[value="copy"]').click()
  await page.waitForFunction(async target=>(await import('/src/app/state.ts')).appState.archive.names().includes(target),copiedTarget)
  assert.deepEqual(await page.evaluate(async target=>{const {appState}=await import('/src/app/state.ts');return {depth:appState.undoStack.length,bytes:[...appState.archive.getBytes(target)]}},copiedTarget),{depth:copyBefore.depth+1,bytes:copyBefore.bytes},'panel copy records one complete undo step')
  await page.waitForFunction(async()=>!(await import('/src/app/state.ts')).appState.fileOperationRunning)
  await page.locator('#panel-scale-dialog').waitFor({state:'hidden'})
  await page.evaluate(async()=>{(await import('/src/app/edit-history.ts')).undo()})
  assert.equal(await page.evaluate(async target=>(await import('/src/app/state.ts')).appState.archive.names().includes(target),copiedTarget),false,'one undo removes copied file')
  await page.evaluate(async()=>{(await import('/src/app/edit-history.ts')).redo()})
  assert.deepEqual(await page.evaluate(async target=>[...(await import('/src/app/state.ts')).appState.archive.getBytes(target)],copiedTarget),copyBefore.bytes,'redo restores the copied bytes')
  await page.evaluate(async()=>{(await import('/src/app/edit-history.ts')).undo()});await select()
  await more('replace-layout-image')
  await page.locator('#mobile-layout-image-target').selectOption('panel');assert.equal(await page.locator('#mobile-layout-image-config').isDisabled(),true)
  await page.locator('#mobile-layout-image-target').selectOption('key-normal');await page.locator('#mobile-layout-image-config').selectOption('image-follows-layout')
  assert.equal(await page.locator('[data-layout-image-config="image-follows-layout"]').getAttribute('aria-pressed'),'true')
  await page.locator('#mobile-layout-image-config').selectOption('none');await capture('26');await closeDialog()
  await select([],'Info.txt');await capture('27')
  await select();await more('settings');await capture('28')
  for(const [kind,id] of [['appearance','29'],['canvas','30'],['source','31'],['model','32'],['about','33']]){
    if(kind==='model')await page.locator('.mobile-model-link').click()
    else await page.locator(`[data-settings-page="${kind}"]`).click()
    await capture(id)
    await page.locator('.mobile-settings-back').click()
  }
  await closeDialog();await select();await more('mobile-ai-view');await capture('34')
  await select();await page.evaluate(async()=>{const {appState}=await import('/src/app/state.ts');appState.unsavedNew=true;(await import('/src/app/edit-history.ts')).updateDirty()})
  await page.locator('#mobile-home').click();await capture('35');await closeDialog()
  await more('mobile-share');await capture('36');await closeDialog()
  await page.evaluate(async()=>{
    const ops=await import('/src/app/file-operations.ts')
    globalThis.finishVisualOperation=null
    void ops.runFileOperation('导出',()=>{ops.showFileOperationProgress();ops.updateFileOperationProgress(62,'正在写入资源');return new Promise(r=>globalThis.finishVisualOperation=r)})
  });await capture('37','可控的异步写入测试替身，生产进度组件')
  await page.evaluate(()=>finishVisualOperation(true));await page.locator('#file-operation-close:not(:disabled)').waitFor();await closeDialog()
  await more('mobile-export-open');await page.locator('.mobile-export-formats input[value="bds"]').check()
  await savedDownload(()=>page.locator('#mobile-export-dialog button[value="export"]').click(),'bds');await capture('23','通过真实导出按钮下载 BDS 并重开校验');await closeDialog()
  await load();await select()
  await savedDownload(()=>page.locator('#mobile-save').click(),'bdi');await capture('24','通过真实保存按钮下载 BDI 并重开校验');await closeDialog()
  await page.evaluate(async()=>{const ops=await import('/src/app/file-operations.ts');await ops.runFileOperation('导出',()=>{ops.showFileOperationProgress();throw new Error('验收注入：目标位置不可写。原始皮肤和当前修改保持不变。')})});await capture('38','注入目标位置不可写错误，验证生产错误分支')
  await page.getByRole('button',{name:'重试导出',exact:true}).click();await page.locator('#mobile-export-dialog[open]').waitFor();await closeDialog()
  await resource('motion');await page.getByRole('button',{name:'播放预览',exact:true}).last().click();await page.waitForFunction(()=>Number(document.querySelector('.mobile-animation-stage [aria-label="预览时间"]')?.value)>0);await capture('39')
  await select();await page.evaluate(async()=>{document.querySelector('#app-theme').value='dark';(await import('/src/app/preferences.ts')).applyAppTheme()});await capture('40');await page.evaluate(async()=>{document.querySelector('#app-theme').value='light';(await import('/src/app/preferences.ts')).applyAppTheme()})
  await page.locator('.mobile-background-states [data-appearance-state="pressed"]').click();await capture('43')
  await page.locator('#mobile-property-tabs [data-mobile-category="typography"]').click()
  const font=page.locator('[data-style-field="FONT_SIZE"]');await font.fill('40');await font.dispatchEvent('change');await font.blur();await capture('44')
  await page.locator('#mobile-property-tabs [data-mobile-category="appearance"]').click();await page.locator('#mobile-inspector-resize').press('End');await capture('45')
  await page.locator('#mobile-inspector-resize').press('Home');await capture('46')
  await page.locator('#mobile-inspector-resize').press('ArrowDown');
  await page.evaluate(()=>{document.documentElement.style.removeProperty('--mobile-inspector-split');delete document.documentElement.dataset.mobilePanel})
  await select([],'light/skin/port/cand1.cnd');await capture('47')
  await select([],'light/skin/port/py_9.ini');await capture('48')
  await select();await resource('particle');await page.getByRole('button',{name:'播放预览',exact:true}).last().click();await page.waitForFunction(()=>Number(document.querySelector('.mobile-animation-stage [aria-label="预览时间"]')?.value)>0);await capture('49')
  await select();await page.setViewportSize({width:390,height:700});await capture('50','浏览器工具栏占用通过缩小可用 viewport 验证，不伪造地址栏')
  // BDI → SXI reaches the production compatibility confirmation with actual conversion warnings.
  await page.setViewportSize({width:390,height:766});await more('mobile-export-open')
  await page.locator('.mobile-export-formats input[value="sxi"]').check()
  await page.locator('#mobile-export-dialog button[value="export"]').click()
  await page.locator('#file-operation-dialog[data-stage="compatibility"]').waitFor();await capture('22');await page.locator('#file-operation-close').click()
  assert.equal(captures.length,48,'Every screen except the two specification boards is captured')
  assert.deepEqual(errors,[])
  writeFileSync(`${output}/coverage.json`,JSON.stringify({viewport:{width:390,height:766},captures,downloads,errors},null,2))
  console.log(`PASS all ${captures.length} Figma screens`)
}finally{await browser.close();await server.close()}
