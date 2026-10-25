// 系统输入法封装 (全新实现, 契约来自设备画像 youdao-rk3562-x7 与真机实测)
//
// 已证实的设备契约:
//   - 模块 'global' 的 Global 类: new Global() 拿实例
//   - startTextEdit(JSON字符串) 同步返回会话 UUID (带横线)
//   - textEditFinished.on(handler) 收结果; closeTextEdit(uuid) 关闭会话
//   - 回调可能带多个参数: 参数[0] 常是"去横线"的会话 UUID 裸串, 不能当文本;
//     参数里找到 { text, cursorIndex, editConfirmed } 才算结果
//   - 只在 editConfirmed === true 时写回文本 (其余一律当取消, 返回 null)
//
// 设计:
//   - 复用同一个 Global 实例 (设备上反复 new 有泄漏风险, 实测稳定)
//   - 订阅/退订严格配对: open 前订阅, 拿到结果/取消/异常后立刻退订并关闭会话
//   - 打开新会话前先关旧会话 (设备上残留会话会叠加)
//   - 输入法不可用/任何异常 -> open 返回 null, 绝不抛 (页面拿 null 当"用户取消")
import globalModule from 'global'

let manager = null

function getManager() {
  if (!manager) manager = new globalModule.Global()
  return manager
}

function safeStringify(v) {
  try { return JSON.stringify(v) } catch (e) { return '' }
}

/** UUID 归一化: 去横线 + 小写. startTextEdit 返回带横线, 回调里常是不带横线的 32 位 hex */
function normUuid(s) {
  return String(s == null ? '' : s).replace(/-/g, '').toLowerCase()
}

/**
 * 判断某个值是不是"会话 UUID"而不是用户文本.
 * 设备实证: textEditFinished 的第一个参数就是本次会话 UUID (去横线的 32 位 hex).
 * 这里只过滤两种情况, 避免把用户输入的 32 位纯数字/十六进制文本误吞:
 *   1) 归一化后等于本次会话 UUID
 *   2) 带横线的标准 UUID 形态 (8-4-4-4-12)
 */
function isUuidArg(s, myUuid) {
  if (typeof s !== 'string') return false
  const n = normUuid(s)
  if (myUuid !== '' && n === myUuid) return true
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function dbg(msg) {
  try { console.log('[ime] ' + msg) } catch (e) {}
}

/**
 * 创建一次输入法会话句柄.
 * @returns {{ open: function, destroy: function }}
 *   open({ text, placeholder, maxlength, inputType, enterButtonText }) 返回用户确认的文本;
 *   null = 取消 / 输入法不可用 / 异常.
 */
export function createIME() {
  let uuid = null          // 当前会话 UUID (带横线, 原样)
  let resolver = null      // 等待中的 open() resolve
  let subscribed = false
  let destroyed = false

  function subscribe() {
    if (subscribed) return
    subscribed = true
    try { getManager().textEditFinished.on(onFinish) } catch (e) { dbg('订阅 textEditFinished 失败: ' + e) }
  }

  function unsubscribe() {
    if (!subscribed) return
    subscribed = false
    try { getManager().textEditFinished.off(onFinish) } catch (e) {}
  }

  function closeSession() {
    if (uuid === null) return
    const u = uuid
    uuid = null
    try { getManager().closeTextEdit(u) } catch (e) { dbg('closeTextEdit 异常: ' + e) }
  }

  function cleanup() {
    unsubscribe()
    closeSession()
    resolver = null
  }

  function settle(value, reason) {
    const r = resolver
    resolver = null
    unsubscribe()
    closeSession()
    // 最后一道保险: 对外只吐 { text, confirmed, reason } 或 null.
    // 设备回调结构多变 (对象/JSON 字符串/事件包装), 万一上游解析漏了, 这里也不会
    // 把对象丢给页面 (否则页面会写出 "[object Object]").
    let out = null
    if (typeof value === 'string') {
      const s = value.trim()
      if (s !== '') out = { text: s, confirmed: reason === 'confirmed' || reason === undefined, reason: reason || 'confirmed' }
    }
    if (r) r(out)
  }

  /**
   * 回调处理: 收集全部参数, 只认携带 { text, cursorIndex, editConfirmed } 的对象.
   * 第一个参数常是会话 UUID 裸串/对象, 必须过滤, 不能当文本.
   */
  function onFinish() {
    try {
      if (destroyed || resolver === null) return   // 无等待中的会话 -> 忽略重复回调

      const args = []
      for (let i = 0; i < arguments.length; i++) args.push(arguments[i])
      dbg('回调共 ' + args.length + ' 个参数')

      const myUuid = normUuid(uuid)

      // 会话校验: 设备把本次会话 UUID 作为回调参数之一下发 (通常是参数[0]).
      // 若回调携带了 UUID 且不是本次会话 -> 整条丢弃 (防止上一个会话的迟到回调写串).
      let cbUuid = ''
      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (typeof a === 'string' && normUuid(a).length === 32) { cbUuid = normUuid(a); break }
        if (a && typeof a === 'object' && typeof a.uuid === 'string') { cbUuid = normUuid(a.uuid); break }
      }
      if (cbUuid !== '' && myUuid !== '' && cbUuid !== myUuid) {
        dbg('忽略其它会话的回调')
        return
      }

      // ★ 真机实证: 回调里的 data 常常是 **JSON 字符串**
      //   '{"text":"xxx","cursorIndex":3,"editConfirmed":true}'
      //   早期版本把它当"裸字符串"直接返回, 于是调用方拿到的是整串 JSON
      //   ("返回了全部数值"), 而不是 text 的值. 这里统一解析:
      //     1) 字符串且像 JSON -> JSON.parse 后按对象处理
      //     2) 对象且带 string 类型的 text -> 取 text
      //   其余 (纯 UUID / 无关字符串) 一律忽略.
      function pick(v) {
        if (v && typeof v === 'object' && v.data !== undefined && (v.type || v.timestamp !== undefined)) v = v.data
        if (typeof v === 'string') {
          const s = v.trim()
          // 只尝试解析明显是 JSON 对象的串, 避免把用户输入的 "{abc" 当 JSON
          if (s.charAt(0) === '{' && s.indexOf('"text"') > 0) {
            try { return pick(JSON.parse(s)) } catch (e) { return null }
          }
          return null
        }
        if (v && typeof v === 'object' && typeof v.text === 'string') {
          if (v.text === '' || isUuidArg(v.text, myUuid)) return null
          return { text: v.text, confirmed: v.editConfirmed === true }
        }
        return null
      }

      let text = null
      let confirmed = false
      let hasKeyed = false
      for (let i = 0; i < args.length; i++) {
        const r = pick(args[i])
        if (!r) continue
        hasKeyed = true
        if (text === null) text = r.text
        if (r.confirmed) { text = r.text; confirmed = true }
      }

      // ★★ 删掉了原来的"裸字符串兜底"。
      // 它只要在回调参数里看到一个非 UUID 的字符串, 就把**任意字符串**当用户文本
      // 并标记 confirmed = true —— 这正是"发出空 prompt"的来源 (空串也满足 '' !== null)。
      // 现在规则收紧为: 必须拿到**结构化结果** (带 text 字段) 才可能算数。

      // 契约: 必须 ①拿到结构化结果 ②editConfirmed === true ③文本去空白后非空
      //       三者同时满足才算"用户点了发送"; 其余一律当取消。
      const s = (text === null || text === undefined) ? '' : String(text).trim()
      if (!hasKeyed || !confirmed || s === '') {
        dbg('判定为取消/空输入: hasKeyed=' + hasKeyed + ' confirmed=' + confirmed + ' len=' + s.length)
        settle(null, 'cancelled')
        return
      }
      settle(s, 'confirmed')
    } catch (e) {
      dbg('finish 异常(已兜底): ' + e)
      try { settle(null) } catch (e2) {}
    }
  }

  return {
    /**
     * 打开输入法 (带原因版). 返回 Promise<{text, confirmed, reason}|null>:
     *   reason = 'confirmed' (点了发送且有内容) | 'cancelled' (取消/为空)
     * 调用方据此区分"用户取消"和"真的发送了" —— 不会再把取消当成功。
     */
    openEx(opts) {
      return openImpl(opts)
    },

    /**
     * 打开输入法 (兼容旧调用). 返回 Promise<string|null>:
     *   - 用户确认且文本非空 -> 文本
     *   - 取消 / 空输入 / 不可用 / 异常 -> null (不抛)
     */
    open(opts) {
      return openImpl(opts).then(function (r) { return r ? r.text : null })
    },

    /** 关闭会话并退订 (页面卸载时调用; 幂等) */
    destroy() {
      if (destroyed) return
      destroyed = true
      cleanup()
    }
  }

  /** 真正的实现: 打开输入法, resolve { text, confirmed, reason } 或 null */
  function openImpl(opts) {

      if (destroyed) return new Promise(function (resolve) { resolve(null) })
      return new Promise(function (resolve) {
        const o = opts || {}
        cleanup()
        resolver = resolve
        subscribe()
        const cfg = {
          text: String(o.text == null ? '' : o.text),
          placeholder: String(o.placeholder == null ? '' : o.placeholder),
          placeholderColor: '#878A99',
          maxlength: o.maxlength || 64,
          maxLength: o.maxlength || 64,
          inputType: o.inputType || 'ZhCNPreferred',
          autofocus: true,
          showCursor: true,
          cursorColor: '#FB7299',
          cursorSize: 2,
          cursorIndex: String(o.text == null ? '' : o.text).length,
          enterButtonText: o.enterButtonText || '搜索',
          confirmText: o.confirmText || '搜索',
          // 不让输入法自行销毁会话, 由我们拿到结果后统一 closeTextEdit
          shouldCloseOnConfirm: false,
          closeButtonVisible: true,
          returnButtonVisible: true,
          micInputVisible: true,
          multiLinesEditVisible: false
        }
        try {
          uuid = getManager().startTextEdit(safeStringify(cfg))
          dbg('startTextEdit uuid=' + uuid)
          if (!uuid) throw new Error('startTextEdit 未返回 uuid')
        } catch (e) {
          dbg('打开输入法失败: ' + e)
          settle(null)
        }
      })
  }
}
