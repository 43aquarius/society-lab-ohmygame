import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 游戏本体是纯静态构建（society-lab，Canvas 2D，零运行时依赖），
  // 构建产物部署在 public/game/ 下，由根路由 rewrite 直接承载。
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/game/index.html" },
        { source: "/game", destination: "/game/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
