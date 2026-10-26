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
  disconnectSleeper: () => ipcRenderer.invoke('sleeper:disconnect'),
  proposeTrade: p => ipcRenderer.invoke('sleeper:propose', p),
  setLineup: w => ipcRenderer.invoke('sleeper:lineup', w),
  onRanksFileChanged: cb => {
    const h = (_e: unknown, info: Parameters<typeof cb>[0]) => cb(info)
    ipcRenderer.on('ranks:changed', h)
    return () => ipcRenderer.removeListener('ranks:changed', h)
  },
}

contextBridge.exposeInMainWorld('monte', api)
