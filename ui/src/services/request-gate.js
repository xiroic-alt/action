// Pending work only: signed URLs and settled failures are never retained.
export function createRequestGate() {
  const pending = new Map()
  return {
    run: function (request, execute) {
      const method = String(request.method || 'GET').toUpperCase()
      if (method !== 'GET' || request.fresh) return Promise.resolve().then(execute)
      const key = JSON.stringify([method, request.url, request.scope, request.timeoutSec])
      if (pending.has(key)) return pending.get(key)
      let resolveWork, rejectWork
      const work = new Promise(function (resolve, reject) {
        resolveWork = resolve
        rejectWork = reject
      })
      const task = work.then(function (value) {
        pending.delete(key)
        return value
      }, function (error) {
        pending.delete(key)
        throw error
      })
      pending.set(key, task)
      // Capture transport state immediately, including synchronous fallbacks.
      try { resolveWork(execute()) } catch (error) { rejectWork(error) }
      return task
    }
  }
}

// Keep original result objects: page snapshots may hold and update them.
export function createResultCache(limit) {
  const entries = new Map()
  return {
    get: function (key, ttlMs) {
      const entry = entries.get(key)
      if (!entry) return null
      const age = Date.now() - entry.at
      if (age < 0 || age >= ttlMs) {
        entries.delete(key)
        return null
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry.data
    },
    set: function (key, data, order) {
      const previous = entries.get(key)
      // A slow pre-refresh response must not overwrite a newer snapshot.
      if (previous && previous.order > order) return
      entries.delete(key)
      entries.set(key, { at: Date.now(), data: data, order: order })
      while (entries.size > limit) entries.delete(entries.keys().next().value)
    },
    clear: function () { entries.clear() }
  }
}
