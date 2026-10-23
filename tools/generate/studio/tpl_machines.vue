<template>
  <div class="mf-cards">
    <div v-for="m in machines" :key="m.asset_code" class="mf-card" :class="'st-' + m.status">
      <div class="mf-card-head">
        <div>
          <div class="mf-name">{{ m.name }}</div>
          <div class="mf-sub">{{ m.asset_code }} · {{ m.area }}</div>
        </div>
        <span class="mf-pill">{{ m.status }}</span>
      </div>
      <div v-if="m.downtime" class="mf-down">
        {{ m.downtime.reason }}<span v-if="m.downtime.work_request"> · {{ m.downtime.work_request }}</span>
      </div>
      <div class="mf-signals">
        <div v-for="s in m.signals" :key="s.name" class="mf-sig">
          <span>{{ label(s.name) }}</span><b>{{ show(s) }}</b>
        </div>
      </div>
      <div v-if="m.order" class="mf-order">
        <div class="mf-order-top">
          <span>{{ m.order.order_number }} · {{ m.order.part_number }}</span>
          <span>{{ m.order.completed }} / {{ m.order.target }}</span>
        </div>
        <div class="mf-bar"><div class="mf-fill" :style="{ width: pct(m.order) + '%' }"></div></div>
      </div>
      <div v-else class="mf-noorder">No active order</div>
    </div>
  </div>
</template>

<script>
export default {
  computed: {
    machines: function () { return (this.msg && Array.isArray(this.msg.payload)) ? this.msg.payload : [] }
  },
  methods: {
    label: function (n) { return String(n).replace(/_pct$/, ' %').replace(/_/g, ' ') },
    show: function (s) {
      var v = s.value
      if (typeof v === 'number') v = Math.round(v * 10) / 10
      var u = s.unit ? String(s.unit).replace('deg', '°') : ''
      return u ? v + ' ' + u : v
    },
    pct: function (o) { return o.target ? Math.min(100, Math.round(100 * o.completed / o.target)) : 0 }
  }
}
</script>

<style>
.mf-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.mf-card { border-radius: 8px; padding: 14px; background: rgba(var(--v-theme-on-group-background), 0.06); border-top: 4px solid #64748b; }
.mf-card.st-running { border-top-color: #22c55e; }
.mf-card.st-idle { border-top-color: #facc15; }
.mf-card.st-faulted { border-top-color: #ef4444; background: rgba(239, 68, 68, .12); }
.mf-card.st-stopped { border-top-color: #f59e0b; }
.mf-card.st-maintenance { border-top-color: #a855f7; }
.mf-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.mf-name { font-size: 18px; font-weight: 700; }
.mf-sub { font-size: 12px; opacity: .65; }
.mf-pill { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 3px 9px; border-radius: 999px; background: #64748b; color: #fff; }
.st-running .mf-pill { background: #16a34a; }
.st-idle .mf-pill { background: #facc15; color: #1f2937; }
.st-faulted .mf-pill { background: #dc2626; }
.st-stopped .mf-pill { background: #d97706; }
.st-maintenance .mf-pill { background: #9333ea; }
.mf-down { margin-top: 8px; font-size: 13px; color: #fca5a5; }
.mf-signals { margin: 10px 0; display: grid; gap: 4px; }
.mf-sig { display: flex; justify-content: space-between; font-size: 13px; border-bottom: 1px solid rgba(var(--v-theme-on-group-background), 0.1); padding-bottom: 3px; }
.mf-sig span { opacity: .7; text-transform: capitalize; }
.mf-order-top { display: flex; justify-content: space-between; font-size: 12px; opacity: .85; margin-bottom: 4px; }
.mf-bar { height: 8px; border-radius: 4px; background: rgba(var(--v-theme-on-group-background), 0.12); overflow: hidden; }
.mf-fill { height: 100%; background: #facc15; transition: width .6s; }
.mf-noorder { font-size: 12px; opacity: .55; }
</style>
