import { initProjectSwitch } from '../services/project-switch'

export default defineNitroPlugin(() => {
  console.log('[project-switch] Registering project switch coordinator...')
  initProjectSwitch()
  console.log('[project-switch] Coordinator ready.')
})
