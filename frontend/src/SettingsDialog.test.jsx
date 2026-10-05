import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog.jsx'
import { SETTINGS_STORAGE_KEY } from './settings.js'

vi.mock('../wailsjs/go/main/App', () => ({
  GetDefaultOllamaSettings: vi.fn(),
}))
const { GetDefaultOllamaSettings } = await import('../wailsjs/go/main/App')

const defaults = {
  host: 'http://localhost:11434',
  model: 'llama3.1:8b',
  prompt: 'default improve',
  actionPrompts: {
    concise: 'default concise',
    tone: 'default tone',
    expand: 'default expand',
    grammar: 'default grammar',
  },
}

const stored = () => JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY))

function renderDialog(props = {}) {
  const handlers = { onThemeChange: vi.fn(), onClose: vi.fn() }
  render(<SettingsDialog themePreference="system" {...handlers} {...props} />)
  return handlers
}

beforeEach(() => {
  GetDefaultOllamaSettings.mockResolvedValue(defaults)
})

describe('SettingsDialog', () => {
  it('shows the defaults on the General tab', async () => {
    renderDialog()
    expect(await screen.findByDisplayValue('http://localhost:11434')).toBeInTheDocument()
    expect(screen.getByDisplayValue('llama3.1:8b')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
  })

  it('saves an edited model', async () => {
    const user = userEvent.setup()
    renderDialog()
    const model = await screen.findByDisplayValue('llama3.1:8b')
    await user.clear(model)
    await user.type(model, 'qwen3:4b')
    expect(stored().model).toBe('qwen3:4b')
  })

  it('reports theme changes', async () => {
    const user = userEvent.setup()
    const { onThemeChange } = renderDialog()
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(onThemeChange).toHaveBeenCalledWith('dark')
  })

  it('lists one prompt per action on the Prompts tab', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByDisplayValue('llama3.1:8b')
    await user.click(screen.getByRole('tab', { name: 'Prompts' }))

    for (const label of ['Improve writing', 'Make it more concise', 'Improve tone', 'Expand this idea', 'Fix grammar']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.queryByLabelText(/clarify/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Improve writing')).toHaveValue('default improve')
    expect(screen.getByText(/also runs when you press/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('stores an edited prompt as an override and Reset removes it', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByDisplayValue('llama3.1:8b')
    await user.click(screen.getByRole('tab', { name: 'Prompts' }))

    const grammar = screen.getByLabelText('Fix grammar')
    await user.clear(grammar)
    await user.type(grammar, 'Only fix spelling.')
    expect(stored().actionPrompts).toEqual({ grammar: 'Only fix spelling.' })

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(grammar).toHaveValue('default grammar')
    expect(stored().actionPrompts).toEqual({})
  })

  it('loads stored overrides', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ host: 'http://other:1', prompt: 'my improve', actionPrompts: { tone: 'my tone' } }),
    )
    const user = userEvent.setup()
    renderDialog()
    expect(await screen.findByDisplayValue('http://other:1')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Prompts' }))
    expect(screen.getByLabelText('Improve writing')).toHaveValue('my improve')
    expect(screen.getByLabelText('Improve tone')).toHaveValue('my tone')
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(2)
  })

  it('closes on Escape and on the close button', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
