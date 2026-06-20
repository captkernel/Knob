// Thin re-export of the preload bridge so components import from one place
// and we get a clear compile error if the bridge is ever missing.
export const api = window.sounddeck
