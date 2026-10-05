import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'theme'
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

// The user's choice: 'system', 'light' or 'dark'.
export function loadThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function resolveTheme(preference, systemDark = darkQuery.matches) {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

// Sets data-theme on <html> (which the CSS tokens key off) and swaps the
// TinyMCE UI skin, which the editor is told not to load itself.
export function applyTheme(preference) {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme

  const skin = theme === 'dark' ? 'oxide-dark' : 'oxide'
  for (const file of ['skin.min.css', 'content.inline.min.css']) {
    const id = `tinymce-${file}`
    let link = document.getElementById(id)
    if (!link) {
      link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      document.head.prepend(link)
    }
    link.href = `/tinymce/skins/ui/${skin}/${file}`
  }
}

// Returns [preference, setPreference, resolvedTheme].
export function useTheme() {
  const [preference, setPreference] = useState(loadThemePreference)
  const [systemDark, setSystemDark] = useState(darkQuery.matches)

  useEffect(() => {
    const onChange = (e) => setSystemDark(e.matches)
    darkQuery.addEventListener('change', onChange)
    return () => darkQuery.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyTheme(preference)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      // Not persisting the choice is fine.
    }
  }, [preference, systemDark])

  return [preference, setPreference, resolveTheme(preference, systemDark)]
}
