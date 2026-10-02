let unauthorizedHandler = null

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const hasBody = body !== undefined

  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler) {
      unauthorizedHandler(data?.error)
    }
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`)
  }

  return data
}

export const me = () => request('/api/auth/me')

export const login = (username, password) =>
  request('/api/auth/login', { method: 'POST', body: { username, password } })

export const register = (username, password) =>
  request('/api/auth/register', {
    method: 'POST',
    body: { username, password },
  })

export const logout = () => request('/api/auth/logout', { method: 'POST' })

export const listUsers = () => request('/api/users')

export function history(otherUserId, { limit, before } = {}) {
  const query = new URLSearchParams()
  if (limit !== undefined) query.set('limit', String(limit))
  if (before !== undefined && before !== null) query.set('before', String(before))
  const suffix = query.toString()
  return request(`/api/messages/${otherUserId}${suffix ? `?${suffix}` : ''}`)
}