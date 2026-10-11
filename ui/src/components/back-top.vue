<template>
  <div v-if="visible" class="back-top" :style="T.accentR" @click="activate">
    <text class="back-top-label" :style="T.t.onAccent">回到顶部</text>
  </div>
</template>
<script>
export default {
  name: 'back-top',
  props: { visible: { type: Boolean, default: false }, T: { type: Object, required: true } },
  methods: { activate() { this.$emit('activate') } }
}
</script>
<style scoped>
.back-top { position: absolute; right: 12px; bottom: 12px; width: 116px; height: 44px; justify-content: center; align-items: center; z-index: 90; }
.back-top-label { font-size: 17px; }
</style>
