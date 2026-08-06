function makeError(): DOMException {
  return new DOMException('The request is not allowed', 'NotAllowedError')
}

async function copyClipboardApi(text: string): Promise<void> {
  if (!navigator.clipboard) {
    throw makeError()
  }
  await navigator.clipboard.writeText(text)
}

async function copyExecCommand(text: string): Promise<void> {
  const span = document.createElement('span')
  span.textContent = text
  span.style.whiteSpace = 'pre'
  span.style.webkitUserSelect = 'auto'
  span.style.userSelect = 'all'
  document.body.append(span)

  const selection = window.getSelection()
  if (!selection) {
    span.remove()
    throw makeError()
  }
  const range = document.createRange()
  selection.removeAllRanges()
  range.selectNode(span)
  selection.addRange(range)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } finally {
    selection.removeAllRanges()
    span.remove()
  }

  if (!copied) throw makeError()
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await copyClipboardApi(text)
  } catch (error) {
    try {
      await copyExecCommand(text)
    } catch (fallbackError) {
      throw fallbackError || error || makeError()
    }
  }
}
