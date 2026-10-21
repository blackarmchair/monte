/** Last path segment, for either separator: the sheet's file name as the user knows it. Core runs
 *  on desktop and on the phone, so it can't lean on node:path. */
export const fileName = (path: string) => path.split(/[\\/]/).pop() || path
