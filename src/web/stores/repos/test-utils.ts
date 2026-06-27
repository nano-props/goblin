// Re-export shim. The implementations of these helpers now live in
// `#/web/test-utils/bridge.ts`. They were moved out of this file so
// non-repo web tests can use the same bridge plumbing without pulling
// in the repo store.
//
// This shim is marked for removal in the next testing-refactor PR.
// New code should import directly from `#/web/test-utils/bridge.ts`.

export {
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
  createBranchSnapshot,
  createRepoBranch,
  createPullRequest,
  type IpcTestHandler,
} from '#/web/test-utils/bridge.ts'
