import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DailyTestPage from './pages/DailyTestPage'
import FreePuttPage from './pages/FreePuttPage'
import HistoryPage from './pages/HistoryPage'
import StatsPage from './pages/StatsPage'
import TemplateTestPage from './pages/TemplateTestPage'
import { IS_TEMPLATE } from './config'

function App() {
  // Layout renders the top bar + navigation drawer and hosts each page via an
  // <Outlet />. Add new pages as sibling <Route>s below. The Daily Test is home.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DailyTestPage />} />
        <Route path="free" element={<FreePuttPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="stats" element={<StatsPage />} />
        {IS_TEMPLATE && (
          <Route path="template-test" element={<TemplateTestPage />} />
        )}
      </Route>
    </Routes>
  )
}

export default App
