export function createSyncLoop({ storage, getToken, intervalMs = 30000, onError = () => {} }) {
  let timer = null

  const syncNow = async () => {
    try {
      const token = await getToken()
      if (!token) return
      await storage.sync()
    } catch (err) {
      onError(err)
    }
  }

  const start = async () => {
    const token = await getToken().catch(() => null)
    if (!token) return
    await syncNow()
    timer = setInterval(syncNow, intervalMs)
  }

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, syncNow }
}
