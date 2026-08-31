import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth.tsx'
import { StoreProvider } from './offline/StoreProvider.tsx'
import { registerServiceWorker } from './registerSW.ts'
import { applyEnvBadge } from './lib/envBadge.ts'

// Stamp a red env label over the favicon/title on non-prod hosts (e.g. QA).
applyEnvBadge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* AuthProvider restores the signed-in user from the session cookie on load
        and exposes auth state app-wide via useAuth. */}
    <AuthProvider>
      {/* StoreProvider stands up the offline data layer, but only for admins —
          it folds the admin-only event log. Must sit inside AuthProvider. */}
      <StoreProvider>
        {/* BrowserRouter enables client-side routing. Deep links work because Vite
            falls back to index.html in dev; prod needs the same fallback in nginx. */}
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StoreProvider>
    </AuthProvider>
  </StrictMode>,
)

// Install the PWA service worker (production builds only; see registerSW.ts).
registerServiceWorker()
