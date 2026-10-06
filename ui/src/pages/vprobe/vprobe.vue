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
    </div>
  </div>
</template>

<script>
// vprobe v2: play() returned undefined and fired nothing, so drive the element
// through a small matrix and report which call actually starts the sink.
// Logging uses console.warn because only that level reaches the device log.
export default {
  data () {
    return {
      src: '/userdata/test.mp4',
      l0: 'vprobe2 boot',
      l1: 'ref: -',
      l2: 'matrix: -',
      l3: 'events: -',
      l4: 'rate: -',
      l5: 'state: -',
      evt: [],
      results: []
    }
  },
  methods: {
    w (s) { console.warn('[vprobe2] ' + s) },
    note (k, v) {
      this.results.push(k + '=' + v)
      this.l2 = 'matrix: ' + this.results.join(' ')
      this.w(k + '=' + v)
    },
    mark (name, e) {
      if (this.evt.length < 6) this.evt.push(name)
      this.l3 = 'events: ' + this.evt.join(',')
      let raw = ''
      try { raw = JSON.stringify(e) } catch (err) { raw = 'unserializable' }
      this.w('EVT ' + name + ' ' + raw)
    },
    onState (e) { this.mark('state', e) },
    onInfo (e) { this.mark('info', e) },
    onPosition (e) { this.mark('position', e) },
    onComplete (e) { this.mark('complete', e) },
    onError (e) { this.mark('error', e) },
    onBuffer (e) { this.mark('buffer', e) },
    onRateFailed (e) { this.mark('rateFailed', e) },
    onResumed (e) { this.mark('resumed', e) },
    onAudioType (e) { this.mark('audioType', e) },

    safe (label, fn) {
      try { return String(fn()) } catch (e) { return 'THREW:' + (e && e.message ? e.message : e) }
    },

    probe () {
      const v = this.$refs.vv
      this.l1 = 'ref: ' + (v ? 'OK' : 'MISSING')
      this.w('ref=' + (v ? 'ok' : 'missing'))
      if (!v) return

      this.l4 = 'rate: ' + this.safe('getRate', function () { return v.getRate() })
      this.l5 = 'state: ' + this.safe('state', function () { return typeof v.state === 'undefined' ? 'undef' : v.state })

      // Order matters: play() with no argument first, because play(0) may be
      // rejected as a falsy position while a bare play() falls through.
      this.note('noArg', this.safe('play()', function () { return v.play() }))
      this.note('ms0', this.safe('play(0)', function () { return v.play(0) }))
      this.note('ms1', this.safe('play(1)', function () { return v.play(1) }))
    },

    lateRound () {
      const v = this.$refs.vv
      if (!v) return
      // If the first round produced no event at all, retry after layout settles
      // and force the source through the explicit setter instead of the attr.
      if (this.evt.length === 0) {
        this.note('setSrc', this.safe('setSrc', function () { return v.setSrc(this.src) }.bind(this)))
        this.note('afterSrc', this.safe('play(1)', function () { return v.play(1) }))
      }
      this.l5 = 'state: ' + this.safe('state', function () { return typeof v.state === 'undefined' ? 'undef' : v.state })
    }
  },
  mounted () {
    const self = this
    setTimeout(function () { self.probe() }, 600)
    setTimeout(function () { self.lateRound() }, 2500)
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
</style>
