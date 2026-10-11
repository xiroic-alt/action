<template>
  <div class="page" :style="T.page">
    <div class="topbar" :style="T.bar">
      <div class="back" :style="T.actionR" @click="goBack">
        <image class="bac" :src="MIc.back" :style="{ width: '26px', height: '26px' }"></image>
        <text class="bat" :style="T.t.body">返回</text>
      </div>
      <image v-if="face !== ''" class="tface" :src="face" resize="cover"></image>
      <text class="ttl" :style="T.t.title">{{ name !== '' ? name : ('UID ' + talkerId) }}</text>
      <text v-if="status !== ''" class="st" :style="T.t.err">{{ status }}</text>
    </div>

    <scroller class="list" scroll-direction="vertical" :show-scrollbar="true"
              :loadmoreoffset="60" @loadmore="loadMore" @scroll="onReturnScroll($event, 'chatTop')">
      <div ref="chatTop" class="chat-anchor"></div>
      <text v-if="loading && msgs.length === 0" class="center" :style="T.t.titleVar">加载中…</text>
      <div v-else-if="status !== '' && msgs.length === 0" class="center-hit">
        <div class="retry" :style="T.errActionR" @click="reload"><text :style="T.t.err">{{ status }} · 点此重试</text></div>
      </div>
      <div v-else-if="hasMore" class="center-hit" @click="loadMore">
        <text :style="T.t.accentSub">上滑加载更早的消息…</text>
      </div>
      <text v-else-if="msgs.length === 0" class="center" :style="T.t.empty">还没有聊过, 说点什么吧</text>
      <div v-for="m in msgs" :key="m.msgKey" :class="['line', m.fromMe ? 'line-me' : 'line-ta']">
        <div :class="['bubble', m.fromMe ? 'bubble-me' : 'bubble-ta']"
             :style="m.fromMe ? T.accentR : T.insetR">
          <text :style="m.fromMe ? T.t.onAccent : T.t.body">{{ m.text }}</text>
        </div>
      </div>
      <div class="pad"></div>
    </scroller>

    <div class="postbar">
      <div class="post-input" :style="T.insetR" @click="openInput">
        <text class="post-text" :style="T.t.body">{{ draft !== '' ? draft : '输入私信内容…' }}</text>
      </div>
      <div v-if="draft !== ''" class="post-clear" :style="T.actionR" @click="clearDraft"><text :style="T.t.body">清除</text></div>
      <div v-if="failed" class="post-retry" :style="T.errActionR" @click="send"><text :style="T.t.err">重试</text></div>
      <div class="post-btn" :style="T.accentR" @click="send">
        <text :style="T.t.onAccent">{{ sending ? '发送中…' : (failed ? '重试发送' : '发送') }}</text>
      </div>
    </div>
  </div>
</template>

<script>
// 私信会话页 (options: talkerId / name / face)
// 发送只尝试一次 (native 的 curl 固定带 --retry 1, POST 会被整包重放),
// 失败**保留草稿**并给出可重试提示, 由用户自己再点一次 —— 本页没有任何自动重发.
import { getSessionMsgs, sendPrivateMsg } from '../../services/messages.js'
import { tokens } from '../../services/theme.js'
import { createIME } from '../../services/ime.js'
import { hasCookie } from '../../services/auth.js'
import { scrollTopMixin } from '../../services/scroll-top.js'
import { afterPaint } from '../../base-page.js'
import { log, logError } from '../../services/log.js'

const MI = { back: require('../../assets/mi/back_26_w.png') }
const MI_D = { back: require('../../assets/mi/back_26_d.png') }

export default {
  name: 'chat',
  mixins: [scrollTopMixin],
  data() {
    return {
      T: tokens(),
      talkerId: 0,
      name: '',
      face: '',
      msgs: [],
      endSeq: 0,          // 会话游标: 本页最早的 seqno, 往上翻时回传
      hasMore: false,
      loading: false,
      sending: false,
      failed: false,      // 上次发送失败 -> 保留草稿并显示重试
      draft: '',
      status: '',
      ime: null,
      gen: 0
    }
  },
  computed: {
    MIc() { return this.T.dark ? MI : MI_D }
  },
  mounted() {
    this.ime = createIME()
    this.applyOptions((this.$page && this.$page.options) || {})
  },
  methods: {
    onShow() {
      this.T = tokens()
      const page = this.$page
      // 固件对同名页 navTo 只替换不入栈: 换一个会话对象要能就地把页内状态换掉
      if (page && !this._optBound) {
        this._optBound = true
        const self = this
        page.onNewOptions = function (options) { self.applyOptions(options) }
      }
      if (page && page.options) this.applyOptions(page.options)
    },
    onNewOptions(options) { this.applyOptions(options) },
    onReturnScroll(e, target) { this.trackTop(e, target) },
    onUnload() {
      this.gen++
      if (this.ime) { try { this.ime.destroy() } catch (e) {} this.ime = null }
    },

    applyOptions(options) {
      const o = options || {}
      const tid = parseInt(o.talkerId || '0', 10) || 0
      if (!tid) { this.status = '缺少会话对象'; return }
      this.name = String(o.name || this.name)
      this.face = String(o.face || this.face)
      if (tid === this.talkerId) return      // 同一会话: 不重复拉取
      this.talkerId = tid
      this.msgs = []
      this.endSeq = 0
      this.hasMore = false
      this.status = ''
      this.failed = false
      this.load(true)
    },
    goBack() { try { this.$page.finish() } catch (e) { try { $falcon.navTo('msg', {}) } catch (e2) {} } },
    reload() { this.load(true) },

    load(reset) {
      const self = this
      const g = ++this.gen
      this.loading = true
      if (reset) { this.status = ''; this.msgs = []; this.endSeq = 0; this.hasMore = false }
      afterPaint(function () {
        getSessionMsgs(self.talkerId, reset ? 0 : self.endSeq).then(function (r) {
          if (g !== self.gen || !r) return
          const seen = {}
          for (let i = 0; i < self.msgs.length; i++) seen[self.msgs[i].msgKey] = 1
          const add = []
          for (let i = 0; i < r.items.length; i++) { if (!seen[r.items[i].msgKey]) add.push(r.items[i]) }
          // 一页里一条新的都没有说明已经到底 (服务端忽略游标时也不会让人一直翻同一条)
          if (!reset && add.length === 0 && self.msgs.length > 0) self.hasMore = false
          else self.hasMore = !!r.hasMore
          self.msgs = add.concat(self.msgs)   // 更早的插到前面, 保持时间升序
          self.endSeq = r.endSeq || self.endSeq
          try { log('私信', '加载 ' + r.items.length + ' 条 (共 ' + self.msgs.length + ')') } catch (e) {}
        }).catch(function (e) {
          if (g !== self.gen) return
          self.status = (e && e.message ? e.message : String(e)).substring(0, 60)
          logError('私信', '加载失败: ' + self.status)
        }).then(function () {
          if (g !== self.gen) return
          self.loading = false
        })
      })
    },
    loadMore() {
      if (!this.hasMore || this.loading) return
      this.load(false)
    },

    async openInput() {
      try {
        const text = await this.ime.open({ text: this.draft, placeholder: '输入私信内容', maxlength: 200 })
        if (text === null) return              // 取消: 草稿原样保留
        this.draft = text
        this.status = ''
        this.failed = false
      } catch (err) {
        this.status = '输入法打开失败'
        logError('私信', '输入法失败: ' + err)
      }
    },
    clearDraft() { this.draft = ''; this.status = ''; this.failed = false },

    async send() {
      if (this.sending) return
      const text = String(this.draft || '').trim()
      if (text === '') { this.status = '先输入内容'; return }
      if (!hasCookie()) { this.status = '登录后才能发送私信'; return }
      this.sending = true
      this.failed = false
      this.status = ''
      try {
        await sendPrivateMsg(this.talkerId, text)
        // 成功: 就地追加一条 (不重拉整页, 省一次请求也不闪屏)
        const now = Math.floor(Date.now() / 1000)
        this.msgs = this.msgs.concat([{
          msgKey: 'local-' + now + '-' + this.msgs.length,
          seqno: this.endSeq,
          fromMe: true,
          text: text,
          time: now,
          timeText: ''
        }])
        this.draft = ''
        try { log('私信', '已发送 1 条 -> ' + this.talkerId) } catch (e) {}
      } catch (e) {
        // 失败: **只提示不重发**, 草稿留着, 用户自己决定要不要再点
        this.failed = true
        this.status = (e && e.message ? e.message : String(e)).substring(0, 60)
        logError('私信', '发送失败: ' + this.status)
      } finally {
        this.sending = false
      }
    }
  }
}
</script>

<style scoped>
.page { width: 960px; height: 266px; position: absolute; left: 0px; top: 0px; flex-direction: column; }
.topbar { width: 960px; height: 44px; flex-direction: row; align-items: center; }
.back { width: 132px; height: 40px; margin-left: 12px; flex-direction: row; justify-content: center; align-items: center; }
.bac { margin-right: 4px; }
.tface { width: 32px; height: 32px; border-radius: 16px; margin-left: 8px; margin-right: 8px; }
.ttl { flex: 1; lines: 1; text-overflow: ellipsis; overflow: hidden; }
.st { margin-right: 16px; }
.list { width: 100%; flex: 1; }
.chat-anchor { width: 1px; height: 1px; }
.center { width: 100%; text-align: center; margin-top: 16px; }
.center-hit { width: 100%; flex-direction: row; justify-content: center; margin-top: 16px; }
.retry { width: 300px; height: 40px; justify-content: center; align-items: center; }
.line { width: 100%; flex-direction: row; margin-top: 8px; }
.line-me { justify-content: flex-end; }
.line-ta { justify-content: flex-start; }
.bubble { max-width: 620px; padding-left: 14px; padding-right: 14px; padding-top: 8px; padding-bottom: 8px; margin-left: 16px; margin-right: 16px; }
.pad { width: 100%; height: 8px; }
.postbar { width: 960px; height: 52px; flex-direction: row; align-items: center; }
.post-input { flex: 1; height: 40px; margin-left: 16px; justify-content: center; }
.post-text { margin-left: 16px; lines: 1; text-overflow: ellipsis; overflow: hidden; }
.post-clear { width: 96px; height: 40px; margin-left: 8px; justify-content: center; align-items: center; }
.post-retry { width: 96px; height: 40px; margin-left: 8px; justify-content: center; align-items: center; }
.post-btn { width: 150px; height: 40px; margin-left: 8px; margin-right: 16px; justify-content: center; align-items: center; }
</style>
