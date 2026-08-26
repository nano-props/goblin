import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { subscribeServerCommandGenerationAdvance } from '#/web/lib/server-command-generation.ts'
import { goblinLog } from '#/web/logger.ts'
import { setBackgroundSyncRepos } from '#/web/repos/client.ts'

interface BackgroundSyncRegistration {
  setTargets: (targets: GitBackgroundSyncTarget[]) => void
  clearTargets: () => void
}

let desiredTargets: GitBackgroundSyncTarget[] = []
let serverMayHaveRegisteredTargets = false
let registrationController: AbortController | null = null

function declareDesiredTargets(): void {
  registrationController?.abort('background-sync-registration-superseded')
  const controller = new AbortController()
  registrationController = controller
  const targets = desiredTargets
  if (targets.length > 0) serverMayHaveRegisteredTargets = true
  void setBackgroundSyncRepos(targets, controller.signal)
    .then(() => {
      if (registrationController !== controller) return
      if (targets.length === 0) serverMayHaveRegisteredTargets = false
    })
    .catch((err: unknown) => {
      if (registrationController !== controller) return
      if (!controller.signal.aborted) goblinLog.warn('background sync registration failed', { err })
    })
}

// Registration state follows the page-scoped clientId and outlives the
// conditional Vue scope so an interrupted empty declaration can be rehydrated.
subscribeServerCommandGenerationAdvance(() => {
  if (desiredTargets.length === 0 && !serverMayHaveRegisteredTargets) return
  declareDesiredTargets()
})

export const backgroundSyncRegistration: BackgroundSyncRegistration = {
  setTargets(targets) {
    desiredTargets = targets
    if (desiredTargets.length === 0 && !serverMayHaveRegisteredTargets) return
    declareDesiredTargets()
  },
  clearTargets() {
    desiredTargets = []
    if (!serverMayHaveRegisteredTargets) {
      registrationController?.abort('background-sync-targets-cleared')
      registrationController = null
      return
    }
    declareDesiredTargets()
  },
}
