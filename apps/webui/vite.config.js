import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number.parseInt(process.env.VITE_PORT, 10) || 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port
  }
});
