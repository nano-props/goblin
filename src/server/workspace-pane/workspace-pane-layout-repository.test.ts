// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  normalizeWorkspacePaneDurableLayout,
  workspacePaneDurableLayoutsEqual,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

describe('workspace pane layout repository normalization', () => {
  test('preserves explicit empty targets and removes duplicate and invalid static entries', () => {
    expect(
      normalizeWorkspacePaneDurableLayout('/repo', {
        entries: [
          { target: { kind: 'git-branch', branch: 'empty' }, tabs: [] },
          {
            target: { kind: 'git-branch', branch: 'main' },
            tabs: [
              workspacePaneStaticTabEntry('status'),
              workspacePaneStaticTabEntry('status'),
              workspacePaneStaticTabEntry('files'),
            ],
          },
        ],
      }),
    ).toEqual({
      entries: [
        { target: { kind: 'git-branch', branch: 'empty' }, tabs: [] },
        { target: { kind: 'git-branch', branch: 'main' }, tabs: [workspacePaneStaticTabEntry('status')] },
      ],
    })
  })

  test('compares normalized layouts rather than input ordering and duplicates', () => {
    const entry = {
      target: { kind: 'git-branch' as const, branch: 'main' },
      tabs: [workspacePaneStaticTabEntry('status')],
    }
    expect(
      workspacePaneDurableLayoutsEqual(
        '/repo',
        { entries: [entry] },
        {
          entries: [{ ...entry, tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('status')] }],
        },
      ),
    ).toBe(true)
  })
})
