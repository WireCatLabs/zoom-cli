export const profilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const profileAccountKey = (profile: string): string => `zm-profile:${profile}`
