declare module 'virtual:app-config' {
  export const APP_NAME: string
  export const IS_TEMPLATE: boolean
}

// Minimal typings for the Google Identity Services script (loaded at runtime
// from accounts.google.com; see gis.ts). Only the surface we use is declared.
interface GoogleIdCredentialResponse {
  credential: string
}

interface GoogleIdConfiguration {
  client_id: string
  callback: (response: GoogleIdCredentialResponse) => void
  auto_select?: boolean
}

interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void
  disableAutoSelect(): void
}

interface Window {
  google?: { accounts: { id: GoogleAccountsId } }
}
