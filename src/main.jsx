import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MatchSimulator from '../isl_compact.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MatchSimulator />
  </StrictMode>,
)
