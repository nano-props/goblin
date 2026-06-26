// Derived state, validation, and input construction for CreateWorktreeDialog.
//
// Keeping this separate from the component lets the dialog focus on UX state
// (mode, field values, remote branch loading) while this file owns the
// decision-heavy rules: path defaults, branch validation, and whether the
// current fields constitute a submittable CreateWorktreeInput.

import { defaultWorktreePath, formatWorktreePath, tildify, untildify } from '#/web/lib/paths.ts'
import { validateBranchName } from '#/shared/refnames.ts'
import { isResolvableRemotePathInput, type RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { deriveLocalBranchFromRemoteRef, type CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

export type CreateWorktreeDialogMode = CreateWorktreeInput['mode']['kind']

export interface CreateWorktreeFormState {
  mode: CreateWorktreeDialogMode
  base: string
  branch: string
  existingBranch: string
  remoteRef: string
  localBranch: string
  worktreePath: string
  remoteBranches: string[]
}

export interface CreateWorktreeRequest {
  input: CreateWorktreeInput
}

export interface CreateWorktreeDerived {
  selectedRemoteRef: string
  derivedLocalBranch: string
  trackLocalBranch: string
  pathName: string
  defaultPath: string
  effectivePath: string
  displayDefaultPath: string
  displayEffectivePath: string
  pathHintText: string
  baseError: string
  branchError: string
  existingBranchError: string
  localBranchError: string
  validPath: boolean
  input: CreateWorktreeInput | null
}

export type Translate = (key: string, params?: Record<string, string | number>) => string

export function deriveCreateWorktreeForm(
  state: CreateWorktreeFormState,
  repo: RepoState,
  remoteTarget: RemoteRepoTarget | null,
  t: Translate,
): CreateWorktreeDerived {
  const localBranchNames = repo.data.branches.map((b) => b.name)
  const hasLocalBranch = (name: string) => localBranchNames.includes(name)
  const branchWorktree = (name: string) => repo.data.branches.find((b) => b.name === name)?.worktree

  const branchTrimmed = state.branch.trim()
  const selectedRemoteRef = state.remoteRef || state.remoteBranches[0] || ''
  const derivedLocalBranch = deriveLocalBranchFromRemoteRef(selectedRemoteRef) ?? ''
  const trackLocalBranch = state.localBranch.trim() || derivedLocalBranch
  const pathName = worktreePathName({
    mode: state.mode,
    branchTrimmed,
    existingBranch: state.existingBranch,
    trackLocalBranch,
  })
  const pathTrimmed = remoteTarget ? state.worktreePath.trim() : untildify(state.worktreePath.trim())
  const defaultPath = remoteTarget
    ? defaultRemoteWorktreePath(remoteTarget.remotePath, pathName)
    : defaultWorktreePath(repo.id, pathName)
  const effectivePath = pathTrimmed || defaultPath
  const displayDefaultPath = remoteTarget ? formatWorktreePath(defaultPath, remoteTarget) : tildify(defaultPath)
  const displayEffectivePath = remoteTarget ? formatWorktreePath(effectivePath, remoteTarget) : tildify(effectivePath)
  const pathDisabledHint = t('action.create-worktree-path-disabled-hint')
  const pathHintText = !pathName ? pathDisabledHint : effectivePath ? displayEffectivePath : ''

  const branchValidation = branchTrimmed ? validateBranchName(branchTrimmed) : { ok: true }
  const localBranchValidation = trackLocalBranch ? validateBranchName(trackLocalBranch) : { ok: true }
  const baseExists = state.base ? hasLocalBranch(state.base) : false
  const existingBranchExists = state.existingBranch ? hasLocalBranch(state.existingBranch) : false
  const branchExists = branchTrimmed ? hasLocalBranch(branchTrimmed) : false
  const trackLocalBranchExists = trackLocalBranch ? hasLocalBranch(trackLocalBranch) : false

  const existingBranchWorktree =
    state.existingBranch && existingBranchExists ? branchWorktree(state.existingBranch) : undefined
  const branchExistingWorktree = branchTrimmed && branchExists ? branchWorktree(branchTrimmed) : undefined
  const trackLocalBranchWorktree =
    trackLocalBranch && trackLocalBranchExists ? branchWorktree(trackLocalBranch) : undefined

  const baseError =
    state.mode === 'newBranch' && state.base && !baseExists ? t('action.create-worktree-base-missing') : ''
  const branchError =
    state.mode === 'newBranch' && branchTrimmed
      ? !branchValidation.ok
        ? t('action.create-worktree-branch-invalid')
        : branchExists && branchExistingWorktree
          ? t('action.create-worktree-has-worktree', { branch: branchTrimmed })
          : branchExists
            ? t('action.create-worktree-branch-exists')
            : ''
      : ''
  const existingBranchError =
    state.mode === 'existingBranch' && state.existingBranch
      ? !existingBranchExists
        ? t('action.create-worktree-existing-missing')
        : existingBranchWorktree
          ? t('action.create-worktree-has-worktree', { branch: state.existingBranch })
          : ''
      : ''
  const localBranchError =
    state.mode === 'trackRemoteBranch' && trackLocalBranch
      ? !localBranchValidation.ok
        ? t('action.create-worktree-branch-invalid')
        : trackLocalBranchExists && trackLocalBranchWorktree
          ? t('action.create-worktree-has-worktree', { branch: trackLocalBranch })
          : trackLocalBranchExists
            ? t('action.create-worktree-local-branch-exists')
            : ''
      : ''

  const validPath = remoteTarget ? isResolvableRemotePathInput(effectivePath) : effectivePath.length > 0
  const input = buildCreateWorktreeInput(state, {
    branchTrimmed,
    selectedRemoteRef,
    trackLocalBranch,
    effectivePath,
    validPath,
    baseExists,
    existingBranchExists,
    branchError,
    existingBranchError,
    localBranchError,
  })

  return {
    selectedRemoteRef,
    derivedLocalBranch,
    trackLocalBranch,
    pathName,
    defaultPath,
    effectivePath,
    displayDefaultPath,
    displayEffectivePath,
    pathHintText,
    baseError,
    branchError,
    existingBranchError,
    localBranchError,
    validPath,
    input,
  }
}

interface BuildInputContext {
  branchTrimmed: string
  selectedRemoteRef: string
  trackLocalBranch: string
  effectivePath: string
  validPath: boolean
  baseExists: boolean
  existingBranchExists: boolean
  branchError: string
  existingBranchError: string
  localBranchError: string
}

function buildCreateWorktreeInput(state: CreateWorktreeFormState, ctx: BuildInputContext): CreateWorktreeInput | null {
  if (!ctx.validPath) return null
  switch (state.mode) {
    case 'newBranch':
      return ctx.branchTrimmed && !ctx.branchError && ctx.baseExists
        ? {
            worktreePath: ctx.effectivePath,
            mode: { kind: 'newBranch', newBranch: ctx.branchTrimmed, baseRef: state.base },
          }
        : null
    case 'existingBranch':
      return state.existingBranch && ctx.existingBranchExists && !ctx.existingBranchError
        ? {
            worktreePath: ctx.effectivePath,
            mode: { kind: 'existingBranch', branch: state.existingBranch },
          }
        : null
    case 'trackRemoteBranch':
      return ctx.selectedRemoteRef && ctx.trackLocalBranch && !ctx.localBranchError
        ? {
            worktreePath: ctx.effectivePath,
            mode: {
              kind: 'trackRemoteBranch',
              remoteRef: ctx.selectedRemoteRef,
              localBranch: ctx.trackLocalBranch,
            },
          }
        : null
  }
  const exhaustive: never = state.mode
  return exhaustive
}

export function worktreePathName(input: {
  mode: CreateWorktreeDialogMode
  branchTrimmed: string
  existingBranch: string
  trackLocalBranch: string
}): string {
  switch (input.mode) {
    case 'newBranch':
      return input.branchTrimmed
    case 'existingBranch':
      return input.existingBranch
    case 'trackRemoteBranch':
      return input.trackLocalBranch
  }
  const exhaustive: never = input.mode
  return exhaustive
}

export function defaultRemoteWorktreePath(repoPath: string, name: string): string {
  const slug = name.trim().replaceAll('/', '-')
  if (!slug) return ''
  const normalized = repoPath.replace(/\/+$/, '')
  const baseName = normalized.split('/').filter(Boolean).at(-1) ?? 'worktree'
  const parent = normalized.slice(0, Math.max(0, normalized.lastIndexOf('/'))) || '/'
  return `${parent === '/' ? '' : parent}/${baseName}-${slug}`
}
