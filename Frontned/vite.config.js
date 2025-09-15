import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
  allowedHosts: ['*.ngrok-free.app'],
  hmr: {
    clientPort: 443, // force secure WS port
    host: '01ab2476af75.ngrok-free.app/'
  }
}

})
