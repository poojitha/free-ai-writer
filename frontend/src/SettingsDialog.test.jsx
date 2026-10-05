import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog.jsx'
import { SETTINGS_STORAGE_KEY } from './settings.js'

vi.mock('../wailsjs/go/main/App', () => ({
  GetDefaultSettings: vi.fn(),
}))
const { GetDefaultSettings } = await import('../wailsjs/go/main/App')

const defaults = {
  providers: {
    ollama: { host: 'http://localhost:11434', model: 'llama3.1:8b' },
    openai: { host: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
    anthropic: { host: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
  },
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
  GetDefaultSettings.mockResolvedValue(defaults)
})

describe('SettingsDialog', () => {
  it('shows the defaults on the General tab', async () => {
    renderDialog()
    expect(await screen.findByDisplayValue('http://localhost:11434')).toBeInTheDocument()
    expect(screen.getByDisplayValue('llama3.1:8b')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
  })

  it('saves an edited model only when Save is clicked', async () => {
    const user = userEvent.setup()
    renderDialog()
    const model = await screen.findByDisplayValue('llama3.1:8b')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await user.clear(model)
    await user.type(model, 'qwen3:4b')
    expect(stored()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')

    await user.click(save)
    expect(stored().providers.ollama.model).toBe('qwen3:4b')
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(save).toBeDisabled()
  })

  it('discards unsaved edits when closed', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()
    await user.type(await screen.findByDisplayValue('llama3.1:8b'), '-x')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(stored()).toBeNull()
  })

  it('switches provider from the dropdown and keeps a separate model and API key for each', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByDisplayValue('llama3.1:8b')
    const providerSelect = screen.getByRole('combobox', { name: 'AI provider' })
    expect(providerSelect).toHaveValue('ollama')
    expect(screen.queryByLabelText(/^API key/)).not.toBeInTheDocument()

    await user.selectOptions(providerSelect, 'Claude (Anthropic)')
    expect(screen.getByLabelText('Anthropic API URL')).toHaveValue('https://api.anthropic.com')
    expect(screen.getByLabelText('Model')).toHaveValue('claude-sonnet-5-5')
    await user.type(screen.getByLabelText(/^API key/), 'sk-ant-1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(stored().provider).toBe('anthropic')
    expect(stored().providers.anthropic.apiKey).toBe('sk-ant-1')
    expect(stored().providers.ollama.model).toBe('llama3.1:8b')

    await user.selectOptions(providerSelect, 'ChatGPT (OpenAI)')
    expect(screen.getByLabelText(/^API key/)).toHaveValue('')
    await user.selectOptions(providerSelect, 'Claude (Anthropic)')
    expect(screen.getByLabelText(/^API key/)).toHaveValue('sk-ant-1')
  })

  it('offers Other for any OpenAI-compatible API, with no defaults and an optional key', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByDisplayValue('llama3.1:8b')

    await user.selectOptions(screen.getByRole('combobox', { name: 'AI provider' }), 'Other (OpenAI-compatible)')
    expect(screen.getByText(/Any OpenAI-compatible API/)).toBeInTheDocument()
    const url = screen.getByLabelText('API URL')
    expect(url).toHaveValue('')
    expect(screen.getByLabelText('Model')).toHaveValue('')
    expect(screen.getByLabelText(/^API key \(if the server needs one\)/)).toHaveValue('')

    await user.type(url, 'https://openrouter.ai/api/v1')
    await user.type(screen.getByLabelText('Model'), 'meta-llama/llama-3.1-8b-instruct')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(stored().provider).toBe('custom')
    expect(stored().providers.custom).toEqual({
      host: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-3.1-8b-instruct',
      apiKey: '',
    })
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
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(stored().actionPrompts).toEqual({ grammar: 'Only fix spelling.' })

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(grammar).toHaveValue('default grammar')
    await user.click(screen.getByRole('button', { name: 'Save' }))
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
