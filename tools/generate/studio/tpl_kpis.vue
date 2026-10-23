<template>
  <div class="mf-kpis">
    <div class="mf-kpi">
      <div class="mf-kpi-label">Machines running</div>
      <div class="mf-kpi-value">{{ k.running }} / {{ k.total }}</div>
      <div class="mf-kpi-sub">{{ k.down_now }} faulted or stopped</div>
    </div>
    <div class="mf-kpi" :class="yieldClass">
      <div class="mf-kpi-label">First-pass yield today</div>
      <div class="mf-kpi-value">{{ yieldText }}</div>
      <div class="mf-kpi-sub">{{ k.good }} good · {{ k.scrap }} scrap · target {{ k.yield_target }}%</div>
    </div>
    <div class="mf-kpi" :class="{ 'mf-bad': k.downtime_min > 0 }">
      <div class="mf-kpi-label">Downtime today</div>
      <div class="mf-kpi-value">{{ k.downtime_min }} min</div>
      <div class="mf-kpi-sub">all machines</div>
    </div>
    <div class="mf-kpi" :class="{ 'mf-bad': k.open_wr > 0 }">
      <div class="mf-kpi-label">Open work requests</div>
      <div class="mf-kpi-value">{{ k.open_wr }}</div>
      <div class="mf-kpi-sub">waiting for maintenance</div>
    </div>
  </div>
</template>

<script>
export default {
  computed: {
    k: function () {
      var p = this.msg && this.msg.payload
      return (p && typeof p === 'object' && !Array.isArray(p)) ? p : { running: 0, total: 0, down_now: 0, good: 0, scrap: 0, yield_target: 95, downtime_min: 0, open_wr: 0 }
    },
    yieldPct: function () {
      var t = this.k.good + this.k.scrap
      return t ? Math.round(1000 * this.k.good / t) / 10 : null
    },
    yieldText: function () { return this.yieldPct === null ? '–' : this.yieldPct + ' %' },
    yieldClass: function () {
      if (this.yieldPct === null) return {}
      return this.yieldPct >= this.k.yield_target ? { 'mf-good': true } : { 'mf-warn': true }
    }
  }
}
</script>

<style>
.mf-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.mf-kpi { border-radius: 8px; padding: 14px 16px; background: rgba(var(--v-theme-on-group-background), 0.06); border-left: 4px solid rgba(var(--v-theme-on-group-background), 0.25); }
.mf-kpi-label { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.mf-kpi-value { font-size: 34px; font-weight: 700; line-height: 1.15; margin: 4px 0; }
.mf-kpi-sub { font-size: 12px; opacity: .65; }
.mf-kpi.mf-good { border-left-color: #22c55e; }
.mf-kpi.mf-warn { border-left-color: #f59e0b; }
.mf-kpi.mf-bad { border-left-color: #ef4444; }
</style>
