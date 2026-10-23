<template>
  <div class="mf-stats">
    <div class="mf-stat">
      <div class="mf-stat-label">Good parts today</div>
      <div class="mf-stat-value">{{ s.good }}</div>
      <div class="mf-stat-sub">{{ s.orders_done }} orders completed</div>
    </div>
    <div class="mf-stat" :class="{ 'mf-warn': s.scrap_pct > 5 }">
      <div class="mf-stat-label">Scrap rate</div>
      <div class="mf-stat-value">{{ s.scrap_pct }} %</div>
      <div class="mf-stat-sub">{{ s.scrap }} scrapped parts</div>
    </div>
    <div class="mf-stat">
      <div class="mf-stat-label">Avg repair time</div>
      <div class="mf-stat-value">{{ s.mttr_min === null ? '–' : s.mttr_min + ' min' }}</div>
      <div class="mf-stat-sub">{{ s.stops }} stops today</div>
    </div>
    <div class="mf-stat" :class="{ 'mf-bad': s.longest_min > 15 }">
      <div class="mf-stat-label">Longest stop</div>
      <div class="mf-stat-value">{{ s.longest_min }} min</div>
      <div class="mf-stat-sub">{{ s.longest_machine || 'none today' }}</div>
    </div>
  </div>
</template>

<script>
export default {
  computed: {
    s: function () {
      var p = this.msg && this.msg.payload
      return (p && typeof p === 'object' && !Array.isArray(p)) ? p : { good: 0, scrap: 0, scrap_pct: 0, orders_done: 0, mttr_min: null, stops: 0, longest_min: 0, longest_machine: null }
    }
  }
}
</script>

<style>
.mf-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.mf-stat { border-radius: 8px; padding: 12px 16px; background: #1f2937; color: #ffffff; border-left: 4px solid #facc15; }
.mf-stat-label { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.mf-stat-value { font-size: 30px; font-weight: 700; line-height: 1.15; margin: 4px 0; }
.mf-stat-sub { font-size: 12px; opacity: .65; }
.mf-stat.mf-warn { border-left-color: #f59e0b; }
.mf-stat.mf-bad { border-left-color: #ef4444; }
</style>
