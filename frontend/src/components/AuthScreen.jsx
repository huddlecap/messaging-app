import { useState } from 'react'
import * as api from '../api.js'

const USERNAME_RULE = 'Username must be 3-50 characters'
const PASSWORD_RULE = 'Password must be 8-72 characters'

function validate(mode, username, password) {
  const errors = {}

  if (mode === 'register') {
    const cleanUsername = username.trim()

    if (cleanUsername.length < 3 || cleanUsername.length > 50) {
      errors.username = USERNAME_RULE
    }

    const passwordBytes = new TextEncoder().encode(password).length
    if (password.length < 8 || passwordBytes > 72) {
      errors.password = PASSWORD_RULE
    }
  } else {
    if (!username) {
      errors.username = 'Username is required'
    }

    if (!password) {
      errors.password = 'Password is required'
    }
  }

  return errors
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)

  function switchMode(nextMode) {
    setMode(nextMode)
    setFieldErrors({})
    setServerError('')
    setNotice('')
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const errors = validate(mode, username, password)
    setFieldErrors(errors)
    setServerError('')

    if (Object.keys(errors).length > 0) {
      return
    }

    setPending(true)

    try {
      if (isLogin) {
        const data = await api.login(username, password)
        onAuthenticated({ id: data.id, username: data.username })
      } else {
        await api.register(username, password)
        setMode('login')
        setUsername(username.trim())
        setPassword('')
        setNotice('Account created — log in')
      }
    } catch (error) {
      setServerError(error.message)
    } finally {
      setPending(false)
    }
  }

  const isLogin = mode === 'login'

  return (
    <main className="auth">
      <h1>{isLogin ? 'Log in' : 'Register'}</h1>

      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        {fieldErrors.username && <p className="error">{fieldErrors.username}</p>}

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {fieldErrors.password && <p className="error">{fieldErrors.password}</p>}

        {notice && <p className="notice">{notice}</p>}

        {serverError && <p className="error">{serverError}</p>}

        <button type="submit" disabled={pending}>
          {pending ? 'Working…' : isLogin ? 'Log in' : 'Register'}
        </button>
      </form>

      <button type="button" className="link" onClick={() => switchMode(isLogin ? 'register' : 'login')}>
        {isLogin ? 'Need an account? Register' : 'Already registered? Log in'}
      </button>
    </main>
  )
}

export default AuthScreen