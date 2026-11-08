export const name = 'linkify'
export const inject = []

// Host half is intentionally a no-op: this bundle only ships a client half that
// registers a user-text rule and its renderer. The row exists so the web client
// resolves the ./client entry.
export function apply() {}
