# Shortcuts

One central registry/window listener dispatches guarded actions to the dynamic Store. Defaults include F8 pause/resume, Alt+Left/Right navigation, Alt+S/U status marks, A-D choices, and Alt+Enter section completion. Destructive submit actions have no default binding.

Settings show friendly names, bindings, conflict/reserved-key validation, key capture, clearing, restoring defaults, and practical help. Internal IDs/scope lists/debug metadata are hidden. Saved settings retain valid current bindings and ignore obsolete keys, including removed Speaking actions.

The answer card has per-item navigation/state labels and `aria-current`. Pause/resume is shared with Typing and is the exception to ordinary text-input shortcut blocking. Short/long Writing editors have per-item Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z history. Business shortcuts preserve native clipboard commands and IME composition.

Text inputs/contenteditable, dialogs, batch creation, close hold, pause, AltGraph, and repeated events have guards. Only successfully handled editor history prevents native events. Shortcuts are app-local; no system-wide capture is installed.
