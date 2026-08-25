import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { subscribeServerCommandTransportReset } from '#/web/lib/server-command-transport.ts'
import { goblinLog } from '#/web/logger.ts'
import { setBackgroundSyncRepos } from '#/web/repos/client.ts'

interface BackgroundSyncRegistrationOwner {
  setTargets: (targets: GitBackgroundSyncTarget[]) => void
  dispose: () => void
}

let desiredTargets: GitBackgroundSyncTarget[] = []
let mayHaveDeclaredTarget = false
let registrationController: AbortController | null = null

function declareDesiredTargets(): void {
  registrationController?.abort('background-sync-registration-superseded')
  const controller = new AbortController()
  registrationController = controller
  const targets = desiredTargets
  if (targets.length > 0) mayHaveDeclaredTarget = true
  void setBackgroundSyncRepos(targets, controller.signal)
    .then(() => {
      if (registrationController !== controller) return
      if (targets.length === 0) mayHaveDeclaredTarget = false
    })
    .catch((err: unknown) => {
      if (registrationController !== controller) return
      if (!controller.signal.aborted) goblinLog.warn('background sync registration failed', { err })
    })
}

// Registration state follows the page-scoped clientId and outlives the
// conditional Vue owner so an interrupted empty declaration can be rehydrated.
subscribeServerCommandTransportReset(() => {
  if (desiredTargets.length === 0 && !mayHaveDeclaredTarget) return
  declareDesiredTargets()
})

export const backgroundSyncRegistration: BackgroundSyncRegistrationOwner = {
  setTargets(targets) {
    desiredTargets = targets
    if (desiredTargets.length === 0 && !mayHaveDeclaredTarget) return
    declareDesiredTargets()
  },
  dispose() {
    desiredTargets = []
    if (!mayHaveDeclaredTarget) {
      registrationController?.abort('background-sync-owner-disposed')
      registrationController = null
      return
    }
    declareDesiredTargets()
  },
}
