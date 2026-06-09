export async function runSettingsControllerAction<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (err) {
    console.warn(`[settings] ${label} failed`, err)
    return null
  }
}
