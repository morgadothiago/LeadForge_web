import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // LOCAL (nao commitar): libera o host do tunel Cloudflare no next dev (teste do webhook do AbacatePay).
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
