/** Presentation-only grouping: neither real tab type nor state is rewritten. */
import type { ReactNode } from 'react'
import type { NewTabOption } from './TabBar.tsx'

export const BROWSER_ENTRY_TYPE = 'browser'
export const EGO_BROWSER_TYPE = 'ego-browser:watch'

export function isBrowserType(type: string): boolean {
  return type === BROWSER_ENTRY_TYPE || type === EGO_BROWSER_TYPE
}

/**
 * The family's three glyphs (outline/currentColor, distinct at 16px): the
 * unified outer entry keeps the neutral globe while the two modes get their
 * own marks — Web preview a browser window, Agent browser a robot head with
 * a pointer. The caller supplies the elements so this module stays free of
 * React values; omitted glyphs fall back to the descriptor icons.
 */
export interface BrowserEntryIcons {
  /** The unified outer entry: a neutral globe outline. */
  browser?: ReactNode
  /** The Web preview mode: a browser window with a top bar. */
  preview?: ReactNode
  /** The Agent browser mode: a robot head with a pointer. */
  agent?: ReactNode
}

/** The caller supplies only registered, enabled, non-hidden descriptors. */
export function groupBrowserOptions(
  options: readonly NewTabOption[],
  labels: { browser: string; preview: string; agent: string },
  icons?: BrowserEntryIcons,
): NewTabOption[] {
  const modes = [BROWSER_ENTRY_TYPE, EGO_BROWSER_TYPE]
    .flatMap(type => options.filter(option => option.id === type))
    .map(option => ({
      ...option,
      label: option.id === BROWSER_ENTRY_TYPE ? labels.preview : labels.agent,
      icon: option.id === BROWSER_ENTRY_TYPE ? icons?.preview ?? option.icon : icons?.agent ?? option.icon,
    }))
  // Keep the existing Preview-only entry unchanged when Ego is not registered/enabled.
  if (!modes.some(mode => mode.id === EGO_BROWSER_TYPE)) {
    // With a supplied family glyph the lone known browser option is still the
    // family's OUTER entry, so it presents the globe (its descriptor carries
    // the Web-preview window); only this known option is touched — every
    // other option passes through untouched and keeps its own id, label,
    // disabled state and absence of submenu. Omitted icons keep the original
    // contract of returning the options exactly as supplied.
    if (icons?.browser === undefined) return [...options]
    return options.map(option => option.id === BROWSER_ENTRY_TYPE ? { ...option, icon: icons.browser } : option)
  }
  const entry: NewTabOption = {
    id: BROWSER_ENTRY_TYPE,
    label: labels.browser,
    icon: icons?.browser ?? modes[0]?.icon,
    disabled: modes.every(mode => mode.disabled === true),
    submenu: modes,
  }
  let inserted = false
  return options.flatMap(option => {
    if (!isBrowserType(option.id)) return [option]
    if (inserted) return []
    inserted = true
    return [entry]
  })
}

/** Actual mode ids, including unavailable-for-creation modes that can still activate. */
export function browserModes(options: readonly NewTabOption[]): NewTabOption[] {
  const entry = options.find(option => option.id === BROWSER_ENTRY_TYPE)
  return entry?.submenu ?? (entry === undefined ? [] : [entry])
}

/** Disabled or unregistered modes cannot light a different enabled family member. */
export function browserEntryType(type: string | undefined, enabledTypes: readonly string[]): string | undefined {
  if (type === undefined || !isBrowserType(type)) return type
  return enabledTypes.includes(type) ? BROWSER_ENTRY_TYPE : undefined
}
