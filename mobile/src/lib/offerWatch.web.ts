// The browser preview has no background tasks or local notifications.
export const enableOfferAlerts = async (): Promise<boolean> => false
export const disableOfferAlerts = async (): Promise<void> => {}
export const watchOffers = (_openLeague: (leagueId: string) => void): (() => void) => () => {}
