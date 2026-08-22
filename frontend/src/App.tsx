import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import TemplateTestPage from './pages/TemplateTestPage'
import { IS_TEMPLATE } from './config'

function App() {
  // Layout renders the top bar + navigation drawer and hosts each page via an
  // <Outlet />. Add new pages as sibling <Route>s below.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        {IS_TEMPLATE && (
          <Route path="template-test" element={<TemplateTestPage />} />
        )}
      </Route>
    </Routes>
  )
}

export default App
