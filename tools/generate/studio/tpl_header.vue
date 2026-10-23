<template>
  <div class="mf-head">
    <svg class="mf-logo" viewBox="0 0 48 48" role="img" aria-label="Manufaction">
      <rect width="48" height="48" rx="6" fill="#1f2937" />
      <path d="M10 39V13l14 15 14-15v26M24 8v15" fill="none" stroke="#facc15" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="10" cy="39" r="3.4" fill="#ffffff" /><circle cx="38" cy="39" r="3.4" fill="#ffffff" /><circle cx="24" cy="8" r="3.4" fill="#ffffff" />
      <circle cx="24" cy="28" r="5.4" fill="#facc15" /><circle cx="24" cy="28" r="2" fill="#1f2937" />
    </svg>
    <div class="mf-plant">{{ plant }}</div>
  </div>
</template>

<script>
export default {
  computed: {
    plant: function () {
      var p = this.msg && this.msg.payload
      return typeof p === 'string' && p ? p : 'Plant overview'
    }
  }
}
</script>

<style>
.mf-head { display: flex; align-items: center; gap: 14px; }
.mf-logo { width: 40px; height: 40px; flex: none; }
.mf-plant { font-family: 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif; font-size: 26px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
</style>
