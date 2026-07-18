export interface RuntimeProjectionTarget {
  repoRoot: string
  repoRuntimeId: string
}

interface RuntimeProjectionOperation {
  generation: number
  controller: AbortController
  rerun: (() => void) | null
}

interface RuntimeProjectionTimer {
  handle: ReturnType<typeof setTimeout>
}

type RuntimeProjectionDisposer = () => void

export class RuntimeProjectionScope {
  readonly target: RuntimeProjectionTarget
  private readonly isTargetCurrent: (target: RuntimeProjectionTarget) => boolean
  private readonly controller = new AbortController()
  private readonly operationsByLane = new Map<string, RuntimeProjectionOperation>()
  private readonly timersByLane = new Map<string, RuntimeProjectionTimer>()
  private readonly disposers = new Set<RuntimeProjectionDisposer>()
  private nextGeneration = 1
  private active = true

  constructor(target: RuntimeProjectionTarget, isTargetCurrent: (target: RuntimeProjectionTarget) => boolean) {
    this.target = target
    this.isTargetCurrent = isTargetCurrent
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  isActive(): boolean {
    return this.active && !this.signal.aborted && this.isTargetCurrent(this.target)
  }

  commit(effect: () => void): boolean {
    if (!this.isActive()) return false
    effect()
    return true
  }

  runLatest<T>(
    lane: string,
    task: (signal: AbortSignal) => Promise<T>,
    publish: (value: T) => void,
    reject: (error: unknown) => void,
  ): void {
    if (!this.isActive()) return
    const current = this.operationsByLane.get(lane)
    if (current) {
      current.rerun = () => this.runLatest(lane, task, publish, reject)
      return
    }
    const operation: RuntimeProjectionOperation = {
      generation: this.nextGeneration++,
      controller: new AbortController(),
      rerun: null,
    }
    this.operationsByLane.set(lane, operation)
    void this.executeLatest(lane, operation, task, publish, reject)
  }

  track(dispose: RuntimeProjectionDisposer): RuntimeProjectionDisposer {
    let tracked = true
    const release = () => {
      if (!tracked) return
      tracked = false
      this.disposers.delete(release)
      try {
        dispose()
      } catch {}
    }
    if (!this.isActive()) {
      release()
      return release
    }
    this.disposers.add(release)
    return release
  }

  setTimer(lane: string, callback: () => void, delayMs: number): void {
    this.cancelTimer(lane)
    if (!this.isActive()) return
    const timer: RuntimeProjectionTimer = {
      handle: setTimeout(() => {
        if (this.timersByLane.get(lane) !== timer) return
        this.timersByLane.delete(lane)
        this.commit(callback)
      }, delayMs),
    }
    this.timersByLane.set(lane, timer)
  }

  cancelTimer(lane: string): void {
    const timer = this.timersByLane.get(lane)
    if (!timer) return
    this.timersByLane.delete(lane)
    clearTimeout(timer.handle)
  }

  dispose(): void {
    if (!this.active) return
    this.active = false
    this.controller.abort()
    for (const operation of this.operationsByLane.values()) operation.controller.abort()
    this.operationsByLane.clear()
    for (const timer of this.timersByLane.values()) clearTimeout(timer.handle)
    this.timersByLane.clear()
    for (const dispose of Array.from(this.disposers)) dispose()
    this.disposers.clear()
  }

  private async executeLatest<T>(
    lane: string,
    operation: RuntimeProjectionOperation,
    task: (signal: AbortSignal) => Promise<T>,
    publish: (value: T) => void,
    reject: (error: unknown) => void,
  ): Promise<void> {
    try {
      const value = await task(operation.controller.signal)
      if (!operation.rerun) this.commitLatest(lane, operation, () => publish(value), reject)
    } catch (error) {
      if (!operation.rerun) this.commitLatest(lane, operation, () => reject(error))
    } finally {
      if (this.operationsByLane.get(lane) !== operation) return
      this.operationsByLane.delete(lane)
      operation.rerun?.()
    }
  }

  private commitLatest(
    lane: string,
    operation: RuntimeProjectionOperation,
    effect: () => void,
    onEffectError?: (error: unknown) => void,
  ): boolean {
    const current = this.operationsByLane.get(lane)
    if (!current || current.generation !== operation.generation || current !== operation) return false
    return this.commit(() => {
      try {
        effect()
      } catch (error) {
        onEffectError?.(error)
      }
    })
  }
}

export class RuntimeProjectionScopeRegistry {
  private readonly isTargetCurrent: (target: RuntimeProjectionTarget) => boolean
  private readonly scopesByRepoRoot = new Map<string, RuntimeProjectionScope>()
  private readonly disposers = new Set<RuntimeProjectionDisposer>()
  private active = true

  constructor(isTargetCurrent: (target: RuntimeProjectionTarget) => boolean) {
    this.isTargetCurrent = isTargetCurrent
  }

  scopeFor(target: RuntimeProjectionTarget): RuntimeProjectionScope {
    if (!this.active) throw new Error('runtime projection scope registry disposed')
    const current = this.scopesByRepoRoot.get(target.repoRoot)
    if (current?.target.repoRuntimeId === target.repoRuntimeId && current.isActive()) return current
    current?.dispose()
    const scope = new RuntimeProjectionScope(target, this.isTargetCurrent)
    this.scopesByRepoRoot.set(target.repoRoot, scope)
    return scope
  }

  track(dispose: RuntimeProjectionDisposer): RuntimeProjectionDisposer {
    let tracked = true
    const release = () => {
      if (!tracked) return
      tracked = false
      this.disposers.delete(release)
      try {
        dispose()
      } catch {}
    }
    if (!this.active) {
      release()
      return release
    }
    this.disposers.add(release)
    return release
  }

  disposeScopes(): void {
    for (const scope of this.scopesByRepoRoot.values()) scope.dispose()
    this.scopesByRepoRoot.clear()
  }

  dispose(): void {
    if (!this.active) return
    this.active = false
    this.disposeScopes()
    for (const dispose of Array.from(this.disposers)) dispose()
    this.disposers.clear()
  }
}

export function createRuntimeProjectionScopeRegistry(
  isTargetCurrent: (target: RuntimeProjectionTarget) => boolean,
): RuntimeProjectionScopeRegistry {
  return new RuntimeProjectionScopeRegistry(isTargetCurrent)
}
