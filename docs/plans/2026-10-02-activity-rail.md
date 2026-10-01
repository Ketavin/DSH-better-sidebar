# Persistent right activity rail

Desktop views expose the enabled, non-hidden tab registry as a 44px right rail, using the same localized names, 16px icons, ordering and availability checks as the existing + menu. The 32px controls retain native tooltips and keyboard focus. The rail follows the existing theme tokens and panel-host overlay layer.

Clicking an entry activates a matching page through the public service lifecycle. Files selects a pathless explorer; Terminal excludes agent-owned terminals. Existing bottom-panel and floating pages retain their placement, with their owning panel opened or their window raised. Clicking an already active docked page collapses its panel without closing the page or its process. A new page lands in the right workbench. The + menu still creates additional instances normally.

The desktop layout reserves 44px while content is collapsed and adds it to open-panel width. The content panel and toggle cluster sit to the left of the rail. Bottom-panel geometry continues to follow the measured conversation column and shared drag writer. Narrow screens retain the existing floating drawer and zero layout push. Existing session layouts and preferences remain readable; no Session format, host route, dependencies or Harness code changes are required.

Verification covers default visibility, registry order/enabling, multi-instance reuse and callbacks, creation limits, right-pane launch after bottom focus, explorer identity, agent-terminal exclusion, geometry caps and unmount cleanup, plus an installed package browser check on the current production Core.
