<template>
  <!-- vprobe: decide whether the Falcon built-in video element is usable.
       Renders <video> (framework VideoElmApi) plus <hole>, then self-reports on screen
       so a single screenshot answers every open question. -->
  <div class="page">
    <video ref="vv" class="vsurf" :src="src"
           @state="onState" @info="onInfo" @position="onPosition"
           @complete="onComplete" @error="onError"
           @bufferPercent="onBuffer" @setRateFailed="onRateFailed"
           @resumed="onResumed" @audioDeviceTypeChanged="onAudioType"></video>

    <hole class="hole"></hole>

    <div class="hud">
      <text class="l0">{{ head }}</text>
      <text class="l1">{{ refLine }}</text>
      <text class="l2">{{ apiLine }}</text>
      <text class="l3">{{ callLine }}</text>
      <text class="l4">{{ evtLine }}</text>
    </div>
  </div>
</template>

<script>
// Probe goals, in order:
//   Q1 does the tag survive the build (unknown tags may be dropped)?
//   Q2 is the element ref bound at runtime, i.e. VideoElmApi instantiated?
//   Q3 which proto methods actually exist on the instance?
//   Q4 does play(ms) start the sink, and which events fire?
const METHODS = ['play', 'pause', 'resume', 'stop', 'seekto', 'setSrc', 'setRate',
                 'getRate', 'setAudioDeviceType', 'setVideoSurface']

export default {
  data () {
    return {
      src: '/userdata/test.mp4',
      head: 'vprobe boot',
      refLine: 'ref: -',
      apiLine: 'api: -',
      callLine: 'call: -',
      evtLine: 'evt: -',
      evt: []
    }
  },
  methods: {
    log (s) {
      console.log('[vprobe] ' + s)
    },
    mark (s) {
      if (this.evt.length < 4 && this.evt.indexOf(s) < 0) this.evt.push(s)
      this.evtLine = 'evt: ' + (this.evt.length ? this.evt.join(',') : '-')
    },
    onState (e) { this.log('state ' + JSON.stringify(e)); this.mark('state') },
    onInfo (e) { this.log('info ' + JSON.stringify(e)); this.mark('info') },
    onPosition (e) { this.log('position ' + JSON.stringify(e)); this.mark('position') },
    onComplete (e) { this.log('complete ' + JSON.stringify(e)); this.mark('complete') },
    onError (e) { this.log('error ' + JSON.stringify(e)); this.mark('error') },
    onBuffer (e) { this.log('buffer ' + JSON.stringify(e)); this.mark('buffer') },
    onRateFailed (e) { this.log('rateFailed ' + JSON.stringify(e)); this.mark('rateFailed') },
    onResumed (e) { this.log('resumed ' + JSON.stringify(e)); this.mark('resumed') },
    onAudioType (e) { this.log('audioType ' + JSON.stringify(e)); this.mark('audioType') },

    probe () {
      const args = this.$page && this.$page.loadOptions ? this.$page.loadOptions : {}
      if (args && args.src) this.src = args.src
      this.head = 'vprobe ' + this.src

      // Q2: is the element ref bound? Undefined => tag was dropped or never instantiated.
      const v = this.$refs.vv
      const kind = typeof v
      this.refLine = 'ref: ' + (v ? 'OK(' + kind + ')' : 'MISSING')
      this.log('ref=' + (v ? 'ok' : 'missing'))
      if (!v) return

      // Q3: which proto methods exist.
      const have = []
      for (let i = 0; i < METHODS.length; i++) {
        let t = 'x'
        try { t = typeof v[METHODS[i]] } catch (e) { t = 'throw' }
        if (t === 'function') have.push(METHODS[i])
      }
      this.apiLine = 'api: ' + (have.length ? have.join(',') : 'NONE')
      this.log('api=' + have.join('|'))

      // Q4: drive it and see what comes back plus which events fire.
      let r = null
      try {
        r = v.play(0)
        this.callLine = 'play(0): ' + JSON.stringify(r)
      } catch (e) {
        this.callLine = 'play(0) THREW: ' + (e && e.message ? e.message : e)
      }
      this.log('play=' + this.callLine)

      // Report the surface/binding helpers separately, they carry the layout meaning.
      let sv = 'n/a'
      try { sv = typeof v.setVideoSurface } catch (e) { sv = 'throw' }
      this.log('setVideoSurface=' + sv)
    }
  },
  mounted () {
    const self = this
    setTimeout(function () { self.probe() }, 300)
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
.l2 { font-size: 11px; color: #99ccff; }
.l3 { font-size: 11px; color: #ff9999; }
.l4 { font-size: 11px; color: #ffffff; }
</style>
