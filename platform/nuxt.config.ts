// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  modules: ['@nuxt/ui'],

  // Nuxt scans ~/components by default; additional dirs are additive.
  components: [
    { path: '~/components' },
    { path: '~/components/driver', pathPrefix: false },
  ],

  runtimeConfig: {
    projectPath: process.env.PROJECT_PATH || '',
  },

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  future: {
    compatibilityVersion: 4,
  },
})
