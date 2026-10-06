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
    </div>
  </div>
</template>

<script>
// vprobe v3: the element ignored a bare filesystem path and emitted nothing.
// The stock player's own atoms (videoproxy, /__video_proxy__/) show it only
// ever feeds the element an http(s) source, so drive it with a real https mp4.
// Source comes from loadOptions.src so the debug route can vary it without a rebuild.
const DEFAULT_SRC = 'https://media.w3.org/2010/05/sintel/trailer.mp4'

export default {
  data () {
    return {
      src: DEFAULT_SRC,
      l0: 'vprobe3 boot',
      l1: 'ref: -',
      l2: 'play: -',
      l3: 'events: -',
      l4: 'last: -',
      l5: 'info: -',
      l6: 'pos: -',
      evt: [],
      played: false
    }
  },
  methods: {
    w (s) { console.warn('[vprobe3] ' + s) },
    short (u) { return String(u).replace(/^https?:\/\//, '').slice(0, 52) },
    raw (e) {
      try { return JSON.stringify(e) } catch (err) { return '<?>' }
    },
    mark (name, e) {
      if (this.evt.length < 8) this.evt.push(name)
      this.l3 = 'events: ' + this.evt.join(',')
      this.l4 = 'last: ' + name + ' ' + this.raw(e).slice(0, 88)
      this.w('EVT ' + name + ' ' + this.raw(e))
    },
    onState (e) {
      this.mark('state', e)
      if (e && typeof e.state !== 'undefined') this.l5 = 'info: state=' + e.state
    },
    onInfo (e) {
      this.mark('info', e)
      this.l5 = 'info: ' + this.raw(e).slice(0, 88)
    },
    onPosition (e) {
      this.mark('position', e)
      let v = e && typeof e === 'object' ? (e.position || e.pos || e.current) : e
      this.l6 = 'pos: ' + v
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

    start () {
      const v = this.$refs.vv
      const opt = this.$page && this.$page.loadOptions ? this.$page.loadOptions : {}
      if (opt && opt.src) this.src = opt.src
      this.l0 = 'vprobe3 ' + this.short(this.src)
      this.l1 = 'ref: ' + (v ? 'OK' : 'MISSING')
      this.w('src=' + this.src + ' ref=' + (v ? 'ok' : 'missing'))
      if (!v || this.played) return
      this.played = true

      const r = this.safe(function () { return v.play(1) })
      this.l2 = 'play(1): ' + r
      this.w('play=' + r)
    },

    retry () {
      const v = this.$refs.vv
      if (!v) return
      if (this.evt.length === 0) {
        this.l2 = this.l2 + ' | retry=' + this.safe(function () { return v.play(0) })
        this.w('retry play(0) evt=' + this.evt.length)
      }
    }
  },
  mounted () {
    const self = this
    setTimeout(function () { self.start() }, 900)
    setTimeout(function () { self.retry() }, 3500)
  }
}
</script>

<style lang="less">
.page {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #101014;
}
.vsurf {
  position: absolute;
  top: 0;
  left: 0;
  width: 960px;
  height: 222px;
}
.hole {
  position: absolute;
  top: 0;
  left: 0;
  width: 960px;
  height: 222px;
}
.hud {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
}
.l0 { font-size: 12px; color: #ffcc00; }
.l1 { font-size: 12px; color: #66ff99; }
.l2 { font-size: 11px; color: #ffcc66; }
.l3 { font-size: 11px; color: #99ccff; }
.l4 { font-size: 11px; color: #ff9999; }
.l5 { font-size: 11px; color: #ffffff; }
.l6 { font-size: 11px; color: #66ffcc; }
</style>
