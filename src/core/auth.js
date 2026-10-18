// 登录态 (全新实现)
//
// 与 bilibilipan 同思路但拆得更干净:
//   - 内存态 + 持久化 (sqlite auth 行 > JSON 兜底)
//   - Cookie 字符串只进 native 的 http 头, 不进日志
//   - 提供 cookieHeader(): 给 HttpOnly 场景组装 'Cookie: ...' 头
//
// 账号模型 (所有字段可空):
//   { sessdata, biliJct, dedeUserId, uname, mid, face, level, vip, updatedAt }

import { bilinet } from '../services/native.js'
import { kvGet, kvSet, kvDel, initStore } from './store.js'
import { log } from './log.js'
import { authFilePath, ensureDirs } from './paths.js'

const KEY = 'auth'

let state = null        // 内存态: null = 未登录
let loaded = false

function parseCookie(cookie) {
  // 输入: 整行 Cookie 或只有若干键; 提取三个关键键
  const m = function (k) {
    const re = new RegExp('(?:^|;\\s*)' + k + '=([^;]*)')
    const hit = re.exec(cookie || '')
    return hit ? hit[1].trim() : ''
  }
  return { sessdata: m('SESSDATA'), biliJct: m('bili_jct'), dedeUserId: m('DedeUserID') }
}

function load() {
  if (loaded) return state
  loaded = true
  try {
    const s = kvGet(KEY)
    if (s) { state = JSON.parse(s); return state }
  } catch (e) {}
  // JSON 兜底 (老数据 / 数据库不可用)
  try {
    if (bilinet && typeof bilinet.readFile === 'function') {
      const raw = bilinet.readFile(authFilePath())
      if (raw) {
        const o = JSON.parse(raw)
        if (o && o.sessdata) { state = o; try { kvSet(KEY, JSON.stringify(o)) } catch (e2) {} return state }
      }
    }
  } catch (e) {}
  state = null
  return state
}

function save() {
  if (!state) return
  try { kvSet(KEY, JSON.stringify(state)) } catch (e) {}
  try {
    if (bilinet && typeof bilinet.writeFile === 'function') {
      ensureDirs(bilinet)
      bilinet.writeFile(authFilePath(), JSON.stringify(state))
    }
  } catch (e) {}
}

export function initAuth() {
  try { initStore() } catch (e) {}
  load()
  return state
}

export function hasCookie() { return !!(load() && load().sessdata) }

export function authState() { return load() }

export function getMid() { const s = load(); return (s && s.mid) || 0 }
export function getUname() { const s = load(); return (s && s.uname) || '' }
export function getFace() { const s = load(); return (s && s.face) || '' }

/** 包装成传给 bilinet 的 header 行 */
export function cookieHeader() {
  const s = load()
  if (!s || !s.sessdata) return ''
  let c = 'SESSDATA=' + s.sessdata
  if (s.biliJct) c += '; bili_jct=' + s.biliJct
  if (s.dedeUserId) c += '; DedeUserID=' + s.dedeUserId
  return 'Cookie: ' + c
}

/**
 * 登录: 接受两种输入
 *   saveLogin({ sessdata, bili_jct, dede_userid }, profile)
 *   saveLogin('整行 Cookie 字符串', profile)
 */
export function saveLogin(cookieOrParts, profile) {
  const s = typeof cookieOrParts === 'string'
    ? parseCookie(cookieOrParts)
    : { sessdata: cookieOrParts && cookieOrParts.sessdata, biliJct: cookieOrParts && cookieOrParts.biliJct, dedeUserId: cookieOrParts && cookieOrParts.dedeUserId }
  if (!s.sessdata) return false
  const p = profile || {}
  state = {
    sessdata: s.sessdata,
    biliJct: s.biliJct || '',
    dedeUserId: String(s.dedeUserId || p.mid || ''),
    uname: p.uname || '',
    mid: Number(p.mid) || 0,
    face: p.face || '',
    level: Number(p.level) || 0,
    vip: p.vip || '',
    updatedAt: Math.floor(Date.now() / 1000)
  }
  save()
  log('登录', '已登录 uid=' + state.dedeUserId)
  return true
}

/** 更新账号快照 (nav 接口回来后), 不动 Cookie */
export function updateProfile(profile) {
  const s = load()
  if (!s || !profile) return
  if (profile.uname) s.uname = profile.uname
  if (profile.mid) { s.mid = Number(profile.mid); s.dedeUserId = String(profile.mid) }
  if (profile.face) s.face = profile.face
  if (profile.level) s.level = Number(profile.level)
  s.updatedAt = Math.floor(Date.now() / 1000)
  save()
}

export function clearLogin() {
  state = null
  loaded = true
  try { kvDel(KEY) } catch (e) {}
  try {
    if (bilinet && typeof bilinet.writeFile === 'function') {
      bilinet.writeFile(authFilePath(), JSON.stringify({ sessdata: '', biliJct: '', dedeUserId: '' }))
    }
  } catch (e) {}
  log('登录', '已退出')
}

/** 测试用: 丢掉内存态 */
export function __resetForTest() { state = null; loaded = false }
