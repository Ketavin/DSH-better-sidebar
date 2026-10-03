/** Presentation-only grouping: neither real tab type nor state is rewritten. */
import type { NewTabOption } from './TabBar.tsx'

export const BROWSER_ENTRY_TYPE = 'browser'
export const EGO_BROWSER_TYPE = 'ego-browser:watch'

export function isBrowserType(type: string): boolean {
  return type === BROWSER_ENTRY_TYPE || type === EGO_BROWSER_TYPE
}

/** The caller supplies only registered, enabled, non-hidden descriptors. */
export function groupBrowserOptions(
  options: readonly NewTabOption[],
  labels: { browser: string; preview: string; agent: string },
): NewTabOption[] {
  const modes = [BROWSER_ENTRY_TYPE, EGO_BROWSER_TYPE]
    .flatMap(type => options.filter(option => option.id === type))
    .map(option => ({ ...option, label: option.id === BROWSER_ENTRY_TYPE ? labels.preview : labels.agent }))
  // Keep the existing Preview-only entry unchanged when Ego is not registered/enabled.
  if (!modes.some(mode => mode.id === EGO_BROWSER_TYPE)) return [...options]
  const entry: NewTabOption = {
    id: BROWSER_ENTRY_TYPE,
    label: labels.browser,
    icon: modes[0]?.icon,
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
