import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import App from './App.jsx'
import { applyTheme, loadThemePreference } from './theme.js'
import './App.css'

// Apply the theme before the first render so there's no light flash.
applyTheme(loadThemePreference())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
