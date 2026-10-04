import { describe, expect, it } from 'vitest'
import { browserEntryType, browserModes, groupBrowserOptions } from '../src/client/browser-entry.ts'
import { en, ja, zh } from '../src/client/locales.ts'

const labels = { browser: 'Browser', preview: 'Preview', agent: 'Agent' }

describe('Browser entry grouping', () => {
  it('keeps a Preview-only entry unchanged and never invents an Agent mode', () => {
    const preview = { id: 'browser', label: 'Original browser', icon: 'preview-icon' }
    const options = groupBrowserOptions([{ id: 'git', label: 'Git' }, preview], labels)
    expect(options).toEqual([{ id: 'git', label: 'Git' }, preview])
    expect(browserModes(options)).toEqual([preview])
  })

  it('replaces two family entries with one ordered entry and preserves real child ids', () => {
    const options = [
      { id: 'editor', label: 'Files' },
      { id: 'ego-browser:watch', label: 'Ego', icon: 'ego-icon' },
      { id: 'git', label: 'Git' },
      { id: 'browser', label: 'Browser', icon: 'preview-icon' },
    ]
    const before = structuredClone(options)
    const grouped = groupBrowserOptions(options, labels)
    expect(grouped.map(option => option.id)).toEqual(['editor', 'browser', 'git'])
    expect(grouped[1]!.icon).toBe('preview-icon')
    expect(browserModes(grouped).map(mode => [mode.id, mode.label])).toEqual([
      ['browser', 'Preview'], ['ego-browser:watch', 'Agent'],
    ])
    expect(options).toEqual(before)
  })

  it('uses only the Agent descriptor when Preview is not supplied', () => {
    const grouped = groupBrowserOptions([{ id: 'ego-browser:watch', label: 'Ego' }], labels)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.id).toBe('browser')
    expect(browserModes(grouped).map(mode => mode.id)).toEqual(['ego-browser:watch'])
  })

  it('keeps creation limits on child modes and disables creation only when all modes are limited', () => {
    const limited = { id: 'browser', label: 'Preview', disabled: true }
    const ego = { id: 'ego-browser:watch', label: 'Ego', disabled: false }
    expect(groupBrowserOptions([limited, ego], labels)[0]!.disabled).toBe(false)
    const grouped = groupBrowserOptions([limited, { ...ego, disabled: true }], labels)
    expect(grouped[0]!.disabled).toBe(true)
    expect(browserModes(grouped)).toHaveLength(2)
    expect(browserModes(grouped).every(mode => mode.disabled)).toBe(true)
  })

  it('maps the family glyphs: the globe on the unified entry, per-mode marks on the children', () => {
    const icons = { browser: 'globe-glyph', preview: 'window-glyph', agent: 'robot-glyph' }
    const grouped = groupBrowserOptions([
      { id: 'browser', label: 'Browser', icon: 'descriptor-icon' },
      { id: 'ego-browser:watch', label: 'Ego', icon: 'ego-own-icon' },
    ], labels, icons)
    // The unified entry keeps the globe instead of inheriting the first
    // mode's mark, and each mode row carries its own glyph — the Agent mode's
    // own descriptor icon is superseded so both modes stay distinct.
    expect(grouped[0]!.icon).toBe('globe-glyph')
    expect(browserModes(grouped).map(mode => [mode.id, mode.icon])).toEqual([
      ['browser', 'window-glyph'], ['ego-browser:watch', 'robot-glyph'],
    ])
  })

  it('does not highlight an enabled Agent entry on behalf of a disabled Preview type', () => {
    expect(browserEntryType('browser', ['ego-browser:watch'])).toBeUndefined()
    expect(browserEntryType('ego-browser:watch', ['browser'])).toBeUndefined()
    expect(browserEntryType('ego-browser:watch', ['browser', 'ego-browser:watch'])).toBe('browser')
    expect(browserEntryType('git', ['browser'])).toBe('git')
  })

  it('ships mode labels in zh, en and ja', () => {
    expect([zh.browserModePreview, en.browserModePreview, ja.browserModePreview]).toEqual([
      '网页预览', 'Web preview', 'ウェブプレビュー',
    ])
    expect([zh.browserModeAgent, en.browserModeAgent, ja.browserModeAgent]).toEqual([
      'Agent 浏览器', 'Agent browser', 'Agent ブラウザー',
    ])
  })
})
