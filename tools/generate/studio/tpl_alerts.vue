<template>
  <div>
    <div v-if="alerts.length === 0" class="mf-clear">All clear: no machine is down.</div>
    <div v-for="a in alerts" :key="a.asset_code + a.started_at" class="mf-alert">
      <div class="mf-alert-main">
        <b>{{ a.asset_code }}</b> {{ a.status === 'faulted' ? 'FAULT' : 'STOPPED' }}: {{ a.reason }}
      </div>
      <div class="mf-alert-sub">
        since {{ since(a.started_at) }}
        <span v-if="a.work_request"> · work request <b>{{ a.work_request }}</b> sent to {{ a.assigned_to }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  computed: {
    alerts: function () { return (this.msg && Array.isArray(this.msg.payload)) ? this.msg.payload : [] }
  },
  methods: {
    since: function (iso) {
      var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
      if (s < 60) return s + ' s ago'
      if (s < 3600) return Math.floor(s / 60) + ' min ago'
      return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min ago'
    }
  }
}
</script>

<style>
.mf-clear { padding: 10px 14px; border-radius: 8px; background: rgba(34, 197, 94, .14); border-left: 4px solid #22c55e; }
.mf-alert { padding: 10px 14px; margin-bottom: 8px; border-radius: 8px; background: rgba(239, 68, 68, .16); border-left: 4px solid #ef4444; }
.mf-alert-main { font-size: 16px; }
.mf-alert-sub { font-size: 12px; opacity: .8; margin-top: 2px; }
</style>
