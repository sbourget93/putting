import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DailyTestPage from './pages/DailyTestPage'
import HistoryPage from './pages/HistoryPage'
import LeaderboardPage from './pages/LeaderboardPage'
import ComparePage from './pages/ComparePage'
import UsersPage from './pages/UsersPage'
import TemplateTestPage from './pages/TemplateTestPage'
import { IS_TEMPLATE } from './config'

function App() {
  // Layout renders the top bar + navigation drawer and hosts each page via an
  // <Outlet />. Add new pages as sibling <Route>s below. Daily Putts is home.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DailyTestPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="compare" element={<ComparePage />} />
        {/* Admin-only page; UsersPage guards its own content, backend re-gates. */}
        <Route path="admin/users" element={<UsersPage />} />
        {IS_TEMPLATE && (
          <Route path="template-test" element={<TemplateTestPage />} />
        )}
      </Route>
    </Routes>
  )
}

export default App
