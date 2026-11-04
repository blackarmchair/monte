import { contextBridge, ipcRenderer } from 'electron'
import type { MonteApi } from '@monte/core/types'

const api: MonteApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  findUser: username => ipcRenderer.invoke('sleeper:findUser', username),
  listLeagues: userId => ipcRenderer.invoke('sleeper:leagues', userId),
  leagueContext: (leagueId, userId) => ipcRenderer.invoke('league:context', leagueId, userId),
  runPickOdds: (leagueId, opts) => ipcRenderer.invoke('engine:bb', leagueId, opts),
  runPwopr: leagueId => ipcRenderer.invoke('engine:pwopr', leagueId),
  leagueOverview: leagueId => ipcRenderer.invoke('league:overview', leagueId),
  startSit: (leagueId, userId) => ipcRenderer.invoke('league:startSit', leagueId, userId),
  trades: (leagueId, userId) => ipcRenderer.invoke('league:trades', leagueId, userId),
  draft: (leagueId, userId, draftId) => ipcRenderer.invoke('league:draft', leagueId, userId, draftId),
  draftPicks: draftId => ipcRenderer.invoke('draft:picks', draftId),
  ranks: (leagueId, userId) => ipcRenderer.invoke('league:ranks', leagueId, userId),
  searchPlayers: query => ipcRenderer.invoke('players:search', query),
  playerInfo: id => ipcRenderer.invoke('players:info', id),
  bundledInjuries: () => ipcRenderer.invoke('injuries:bundled'),
  chooseRanksFile: () => ipcRenderer.invoke('ranks:choose'),
  ranksFileInfo: () => ipcRenderer.invoke('ranks:info'),
  connectSleeper: token => ipcRenderer.invoke('sleeper:connect', token),
  signInSleeper: () => ipcRenderer.invoke('sleeper:signIn'),
  disconnectSleeper: () => ipcRenderer.invoke('sleeper:disconnect'),
  leagueWeek: leagueId => ipcRenderer.invoke('league:week', leagueId),
  leagueTrades: leagueId => ipcRenderer.invoke('league:leagueTrades', leagueId),
  proposeTrade: p => ipcRenderer.invoke('sleeper:propose', p),
  setLineup: w => ipcRenderer.invoke('sleeper:lineup', w),
  answerOffer: a => ipcRenderer.invoke('sleeper:answer', a),
  updateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateChanged: cb => {
    const h = (_e: unknown, state: Parameters<typeof cb>[0]) => cb(state)
    ipcRenderer.on('update:changed', h)
    return () => ipcRenderer.removeListener('update:changed', h)
  },
  setSheetLink: link => ipcRenderer.invoke('ranks:link', link),
  trackRecord: userId => ipcRenderer.invoke('league:trackRecord', userId),
  waiverDesk: (leagueId, userId) => ipcRenderer.invoke('league:waivers', leagueId, userId),
  onOpenLeague: cb => {
    const h = (_e: unknown, leagueId: string) => cb(leagueId)
    ipcRenderer.on('offers:open', h)
    return () => ipcRenderer.removeListener('offers:open', h)
  },
  onRanksFileChanged: cb => {
    const h = (_e: unknown, info: Parameters<typeof cb>[0]) => cb(info)
    ipcRenderer.on('ranks:changed', h)
    return () => ipcRenderer.removeListener('ranks:changed', h)
  },
}

contextBridge.exposeInMainWorld('monte', api)
