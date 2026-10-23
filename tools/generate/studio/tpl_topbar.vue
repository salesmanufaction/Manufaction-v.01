<template>
  <div class="mf-topbar">
    <svg class="mf-topbar-logo" viewBox="0 0 48 48" role="img" aria-label="Manufaction">
      <rect width="48" height="48" rx="6" fill="#1f2937" />
      <path d="M10 39V13l14 15 14-15v26M24 8v15" fill="none" stroke="#facc15" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="10" cy="39" r="3.4" fill="#ffffff" /><circle cx="38" cy="39" r="3.4" fill="#ffffff" /><circle cx="24" cy="8" r="3.4" fill="#ffffff" />
      <circle cx="24" cy="28" r="5.4" fill="#facc15" /><circle cx="24" cy="28" r="2" fill="#1f2937" />
    </svg>
    <span class="mf-topbar-title">Manufaction UI</span>
  </div>
</template>

<script>
export default {
  mounted: function () {
    // the page-name bar sits under this banner; tell the stylesheet how tall it is
    var bar = document.querySelector('.v-app-bar')
    if (bar && bar.offsetHeight) document.documentElement.style.setProperty('--mf-bar', bar.offsetHeight + 'px')
  }
}
</script>
