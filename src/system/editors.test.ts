import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vscodeInstalled: vi.fn(() => false),
  cursorInstalled: vi.fn(() => false),
  windsurfInstalled: vi.fn(() => false),
  openRemoteVSCode: vi.fn(),
  openRemoteCursor: vi.fn(),
  openRemoteWindsurf: vi.fn(),
}))

vi.mock('#/system/vscode.ts', () => ({
  isVSCodeInstalled: mocks.vscodeInstalled,
  openInVSCode: vi.fn(),
  openRemoteInVSCode: mocks.openRemoteVSCode,
}))
vi.mock('#/system/cursor.ts', () => ({
  isCursorInstalled: mocks.cursorInstalled,
  openInCursor: vi.fn(),
  openRemoteInCursor: mocks.openRemoteCursor,
}))
vi.mock('#/system/windsurf.ts', () => ({
  isWindsurfInstalled: mocks.windsurfInstalled,
  openInWindsurf: vi.fn(),
  openRemoteInWindsurf: mocks.openRemoteWindsurf,
}))

describe('openRemoteInPreferredEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openRemoteVSCode.mockResolvedValue({ ok: true, message: '/srv/repo' })
    mocks.openRemoteCursor.mockResolvedValue({ ok: true, message: '/srv/repo' })
    mocks.openRemoteWindsurf.mockResolvedValue({ ok: true, message: '/srv/repo' })
  })

  test('opens the explicitly selected remote editor when it is installed', async () => {
    mocks.cursorInstalled.mockReturnValue(true)
    const { openRemoteInPreferredEditor } = await import('#/system/editors.ts')

    await expect(openRemoteInPreferredEditor('prod', '/srv/repo', 'cursor')).resolves.toEqual({
      ok: true,
      message: '/srv/repo',
    })

    expect(mocks.openRemoteCursor).toHaveBeenCalledWith('prod', '/srv/repo')
    expect(mocks.openRemoteVSCode).not.toHaveBeenCalled()
  })

  test('uses auto priority for remote editors', async () => {
    mocks.vscodeInstalled.mockReturnValue(false)
    mocks.cursorInstalled.mockReturnValue(true)
    mocks.windsurfInstalled.mockReturnValue(true)
    const { openRemoteInPreferredEditor } = await import('#/system/editors.ts')

    await openRemoteInPreferredEditor('prod', '/srv/repo', 'auto')

    expect(mocks.openRemoteCursor).toHaveBeenCalledWith('prod', '/srv/repo')
    expect(mocks.openRemoteWindsurf).not.toHaveBeenCalled()
  })

  test('returns editor-not-installed when no configured editor is available', async () => {
    const { openRemoteInPreferredEditor } = await import('#/system/editors.ts')

    await expect(openRemoteInPreferredEditor('prod', '/srv/repo', 'auto')).resolves.toEqual({
      ok: false,
      message: 'error.editor-not-installed',
    })
  })
})
