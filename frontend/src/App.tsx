import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DailyTestPage from './pages/DailyTestPage'
import HistoryPage from './pages/HistoryPage'
import LeaderboardPage from './pages/LeaderboardPage'
import UsersPage from './pages/UsersPage'
import DataPage from './pages/DataPage'

function App() {
  // Layout renders the top bar + navigation drawer and hosts each page via an
  // <Outlet />. Add new pages as sibling <Route>s below. Daily Putts is home.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DailyTestPage />} />
        <Route path="profile" element={<HistoryPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        {/* Admin-only pages; each guards its own content, backend re-gates. */}
        <Route path="admin/users" element={<UsersPage />} />
        <Route path="admin/data" element={<DataPage />} />
      </Route>
    </Routes>
  )
}

export default App
