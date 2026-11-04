/**
 * 端到端脚本里自动确认 ask() 对话框（替代原来的 page.on("dialog", accept)）：
 * 降级导出点「继续导出」，导出调整说明点「好」。只认没有 id 的 ask() 对话框，不碰 #file-operation-dialog。
 */
export function acceptAskDialogs(page) {
  return page.addInitScript(() => {
    new MutationObserver(() => {
      document.querySelector('dialog[open]:not([id]) button:is([value="continue"], [value="close"])')?.click()
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] })
  })
}
