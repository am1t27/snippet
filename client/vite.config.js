import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies Socket.IO traffic and Focus cover art to the game server on
// :3000 so the client can use same-origin requests (no CORS, no hardcoded host).
// In production VITE_SOCKET_URL points both at the deployed backend instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true, // required: the client uses the websocket transport
        changeOrigin: true,
      },
      // Focus serves cover art through the game server, which gates each step
      // by the round clock. Without this the dev client renders a broken image.
      "/art": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
