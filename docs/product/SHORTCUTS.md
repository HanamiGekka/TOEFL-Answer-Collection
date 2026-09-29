# Shortcuts

The app uses a central Shortcut Registry, dispatched through one `window keydown` listener into existing Store/engine actions. Defaults include F8, Alt+Left/Right, Alt+S/U, A–D, and Alt+Enter. Destructive submit actions have no default binding.

Settings support key capture, clearing, restoring defaults, conflict/reserved-key validation, and local persistence. The obsolete `open_review` action without independent value was removed. Loading old settings projects only current Registry actions, discarding that old key while retaining valid bindings such as F1; the old key does not reappear after saving.

- The answer card is not a separate Review mode. It remains visible with question-number navigation, Question status, a yellow current-question border, and `aria-current`.
- `toggle_pause` shares its action ID and user binding between TOEFL and Typing. It is the sole exception to text-input business-shortcut blocking: an active or paused Typing textarea can receive it.
- Writing's Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z belong to local editor history, not the business Shortcut Registry. Email/Discussion route existing Store history; Build a Sentence uses local history isolated by Question ID.
- Business shortcuts do not take over Ctrl+A/C/X/V, native Typing history, Chinese IME composition, or Clipboard behavior.
- Textarea/input/contenteditable, modal, close hold, paused, Speaking pending, AltGraph, and repeat states each have guards. Only successfully handled Writing history actions call `preventDefault()`.
- Shortcuts are app-local by default. Any future Tauri global shortcut must be disableable. Avoid Windows input-method/language-switch combinations.
