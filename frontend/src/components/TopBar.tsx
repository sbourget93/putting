import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { APP_NAME, IS_TEMPLATE } from '../config'
import { useAuth } from '../auth-context'
import SyncMenu from '../offline/SyncMenu'
import GoogleSignInButton from './GoogleSignInButton'
import './TopBar.css'

function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const { user, isAdmin, signOut } = useAuth()

  useEffect(() => {
    if (!menuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <>
      <header className="top-bar">
        <div className="top-bar-row">
          <button
            type="button"
            className="menu-button"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="app-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <span className="app-name">{APP_NAME}</span>
          {/* Global sync envelope, admin-only (self-hidden for non-admins too). */}
          {isAdmin && <SyncMenu />}
        </div>
      </header>

      <div
        className={menuOpen ? 'menu-scrim open' : 'menu-scrim'}
        onClick={() => setMenuOpen(false)}
      />
      <nav
        id="app-menu"
        className={menuOpen ? 'app-menu open' : 'app-menu'}
        aria-label="Main"
        inert={!menuOpen}
      >
        <div className="menu-items">
          <NavLink to="/" end className="menu-item" onClick={closeMenu}>
            Daily Putts
          </NavLink>
          <NavLink to="/history" className="menu-item" onClick={closeMenu}>
            History
          </NavLink>
          <NavLink to="/stats" className="menu-item" onClick={closeMenu}>
            Statistics
          </NavLink>
          {/* Template-only, and absent from a fork's build entirely. */}
          {IS_TEMPLATE && (
            <NavLink
              to="/template-test"
              className="menu-item"
              onClick={closeMenu}
            >
              Template Test
            </NavLink>
          )}
        </div>

        <div className="menu-account">
          {user ? (
            <>
              <div className="account-info">
                {user.picture && (
                  <img
                    className="account-avatar"
                    src={user.picture}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                )}
                <span className="account-name" title={user.email}>
                  {user.name}
                </span>
              </div>
              <button
                type="button"
                className="signout-btn"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </>
          ) : (
            <GoogleSignInButton />
          )}
        </div>
      </nav>
    </>
  )
}

export default TopBar
