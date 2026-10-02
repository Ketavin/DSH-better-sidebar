# Session header panel controls

Sidebar 0.17.8 contributes the bottom/right panel buttons to the public
`conversation.session.header.utilities` slot, beside Session log. The host's
flex row owns alignment; no Core modification or native CSS-module selector
is required.

The buttons retain the existing per-session Sidebar store and actions. The
bottom button is omitted on narrow screens. Controls in a visible current
session header claim placement; the independent panel root removes its corner
copy and unnecessary tab-strip clearance. Hidden/unmounted headers release the
claim. An undeclared slot on older hosts, an empty session page, and an open
mobile drawer retain corner controls. Disabling or reloading the plugin
disposes both registration and placement ownership.

The nine-icon 44px activity rail, tab registry, session storage format, usage
accounting and provider settings retain their existing contracts.
