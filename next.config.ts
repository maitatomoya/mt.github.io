import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  trailingSlash: true,
  // Cloudflare Pagesで配信するため静的エクスポートを有効化
  output: 'export',
  // 静的エクスポートではNext.jsの画像最適化サーバーが使えないため無効化
  images: { unoptimized: true },
}

export default nextConfig
