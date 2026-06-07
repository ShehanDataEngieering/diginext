// Single source of truth for IPC channel names, imported by both the main
// process (registers handlers) and the preload (invokes them) so the two
// sides can't drift out of sync.
export const IPC_CHANNELS = {
  authVerifySession: 'auth:verify-session'
} as const
