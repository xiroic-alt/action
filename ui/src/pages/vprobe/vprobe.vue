<template>
  <div class="page">
    <video ref="vv" class="vsurf" :src="src"
           @state="onState" @info="onInfo" @position="onPosition"
           @complete="onComplete" @error="onError"
           @bufferPercent="onBuffer" @setRateFailed="onRateFailed"
           @resumed="onResumed" @audioDeviceTypeChanged="onAudioType"></video>

    <hole class="hole"></hole>

    <div class="hud">
      <text class="l0">{{ l0 }}</text>
      <text class="l1">{{ l1 }}</text>
      <text class="l2">{{ l2 }}</text>
      <text class="l3">{{ l3 }}</text>
      <text class="l4">{{ l4 }}</text>
      <text class="l5">{{ l5 }}</text>
      <text class="l6">{{ l6 }}</text>
      <text class="l7">{{ l7 }}</text>
    </div>
  </div>
</template>

<script>
// vprobe v4: v3 proved an https source reaches the sink (state + position events)
// but stalled at state 3 (GstState PAUSED) with a black screen. So v4 keeps
// ticking the clock, reports whether position advances, and calls resume() once
// the pipeline reports PAUSED to see if that is what reaches PLAYING.
// Also handles onNewOptions, because navTo on a live page does not remount.
const DEFAULT_SRC = 'https://media.w3.org/2010/05/sintel/trailer.mp4'
const GstState = { 0: 'VOID', 1: 'NULL', 2: 'READY', 3: 'PAUSED', 4: 'PLAYING' }

export default {
  data () {
    return {
      src: DEFAULT_SRC,
      l0: 'vprobe4 boot',
      l1: 'ref: -',
      l2: 'play: -',
      l3: 'events: -',
      l4: 'lastState: -',
      l5: 'pos: -',
      l6: 'ticks: -',
      l7: 'acts: -',
      evt: [],
      ticks: 0,
      acts: [],
      resumedOnce: false,
      pos: -1,
      posHistory: []
    }
  },
  methods: {
    w (s) { console.warn('[vprobe4] ' + s) },
    short (u) { return String(u).replace(/^https?:\/\//, '').slice(0, 50) },
    raw (e) { try { return JSON.stringify(e) } catch (err) { return '<?>' } },
    act (s) {
      if (this.acts.length < 5) this.acts.push(s)
      this.l7 = 'acts: ' + this.acts.join(',')
      this.w('ACT ' + s)
    },
    mark (name, e) {
      if (this.evt.length < 10) this.evt.push(name)
      this.l3 = 'events: ' + this.evt.join(',')
      this.w('EVT ' + name + ' ' + this.raw(e))
    },
    onState (e) {
      this.mark('state', e)
      const s = e && typeof e.state !== 'undefined' ? e.state : -1
      this.l4 = 'lastState: ' + s + ' ' + (GstState[s] || '?')
      // PAUSED means preroll finished and nothing is pushing it further.
      if (s === 3 && !this.resumedOnce) {
        this.resumedOnce = true
        const v = this.$refs.vv
        if (v) {
          const r = this.safe(function () { return v.resume() })
          this.act('resume()=' + r)
        }
      }
    },
    onInfo (e) { this.mark('info', e); this.l5 = 'info: ' + this.raw(e).slice(0, 80) },
    onPosition (e) {
      this.mark('position', e)
      let p = e && typeof e === 'object' ? (e.position || e.pos) : e
      this.pos = p
      if (this.posHistory.length < 10) this.posHistory.push(p)
      this.l6 = 'pos: ' + this.posHistory.join('>')
    },
    onComplete (e) { this.mark('complete', e) },
    onError (e) { this.mark('error', e) },
    onBuffer (e) { this.mark('buffer', e) },
    onRateFailed (e) { this.mark('rateFailed', e) },
    onResumed (e) { this.mark('resumed', e) },
    onAudioType (e) { this.mark('audioType', e) },

    safe (fn) {
      try { return String(fn()) } catch (e) { return 'THREW:' + (e && e.message ? e.message : e) }
    },

    apply (opt, tag) {
      if (opt && opt.src) this.src = opt.src
      this.l0 = 'vprobe4[' + tag + '] ' + this.short(this.src)
      const v = this.$refs.vv
      this.l1 = 'ref: ' + (v ? 'OK' : 'MISSING')
      this.w('apply tag=' + tag + ' src=' + this.src + ' ref=' + (v ? 'ok' : 'missing'))
      if (!v) return
      this.l2 = 'play(1): ' + this.safe(function () { return v.play(1) })
      this.w('play=' + this.l2)
    },

    setSrc () {
      const v = this.$refs.vv
      if (!v) return
      this.act('setSrc=' + this.safe(function () { return v.setSrc(this.src) }.bind(this)))
      this.act('play=' + this.safe(function () { return v.play(1) }))
    },

    tick () {
      this.ticks = this.ticks + 1
      const v = this.$refs.vv
      if (!v) return
      const rate = this.safe(function () { return v.getRate() })
      this.l6 = 'pos: ' + (this.posHistory.length ? this.posHistory.join('>') : '-') +
                '  n=' + this.ticks + ' rate=' + rate
    }
  },
  mounted () {
    const self = this
    const opt = this.$page && this.$page.loadOptions ? this.$page.loadOptions : {}
    setTimeout(function () { self.apply(opt, 'mounted') }, 900)
    setTimeout(function () { self.setSrc() }, 6000)
    setInterval(function () { self.tick() }, 1000)
  },
  onNewOptions (opt) {
    const self = this
    this.w('onNewOptions ' + JSON.stringify(opt || {}))
    setTimeout(function () { self.apply(opt, 'new') }, 300)
  }
}
</script>

<style lang="less">
.page { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #101014; }
.vsurf { position: absolute; top: 0; left: 0; width: 960px; height: 222px; }
.hole { position: absolute; top: 0; left: 0; width: 960px; height: 222px; }
.hud { position: absolute; top: 4px; left: 4px; right: 4px; }
.l0 { font-size: 12px; color: #ffcc00; }
.l1 { font-size: 12px; color: #66ff99; }
.l2 { font-size: 11px; color: #ffcc66; }
.l3 { font-size: 11px; color: #99ccff; }
.l4 { font-size: 12px; color: #ff9999; }
.l5 { font-size: 11px; color: #ffffff; }
.l6 { font-size: 11px; color: #66ffcc; }
.l7 { font-size: 11px; color: #cc99ff; }
</style>
