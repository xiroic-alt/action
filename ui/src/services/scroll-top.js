export const scrollTopMixin = {
  data: function () { return { topShown: false, topTarget: '' } },
  methods: {
    trackTop: function (event, target) {
      const offset = event && event.contentOffset
      const y = offset && typeof offset.y === 'number' ? offset.y : 0
      this.topTarget = target
      const visible = y >= 160
      if (this.topShown !== visible) this.topShown = visible
    },
    goTop: function () {
      const ref = this.$refs && this.$refs[this.topTarget]
      const dom = this.$page && this.$page.$dom
      if (!ref || !dom || typeof dom.scrollToElement !== 'function') return
      try { dom.scrollToElement(Array.isArray(ref) ? ref[0] : ref, { offset: 0 }); this.topShown = false } catch (e) {}
    }
  }
}
