<template>
  <div>
    <div v-for="r in rows" :key="r.asset_code" class="mf-dt-row">
      <div class="mf-dt-name">{{ r.asset_code }}</div>
      <div class="mf-dt-track"><div class="mf-dt-fill" :style="{ width: width(r) + '%' }"></div></div>
      <div class="mf-dt-val">{{ r.minutes }} min</div>
      <div class="mf-dt-why">{{ r.events }} event{{ r.events === 1 ? '' : 's' }}<span v-if="r.top_reason"> · {{ r.top_reason }}</span></div>
    </div>
  </div>
</template>

<script>
export default {
  computed: {
    rows: function () { return (this.msg && Array.isArray(this.msg.payload)) ? this.msg.payload : [] },
    max: function () {
      var m = 0
      this.rows.forEach(function (r) { if (r.minutes > m) m = r.minutes })
      return m || 1
    }
  },
  methods: {
    width: function (r) { return Math.round(100 * r.minutes / this.max) }
  }
}
</script>

<style>
.mf-dt-row { display: grid; grid-template-columns: 110px 1fr 70px; gap: 8px; align-items: center; margin-bottom: 8px; }
.mf-dt-name { font-size: 13px; font-weight: 600; }
.mf-dt-track { height: 10px; border-radius: 5px; background: rgba(var(--v-theme-on-group-background), 0.12); overflow: hidden; }
.mf-dt-fill { height: 100%; background: #ef4444; }
.mf-dt-val { text-align: right; font-size: 13px; }
.mf-dt-why { grid-column: 2 / 4; font-size: 11px; opacity: .6; margin-top: -4px; }
</style>
