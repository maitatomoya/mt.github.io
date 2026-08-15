// 静的エクスポート（output: 'export'）ではルートを静的生成する指定が必須
export const dynamic = 'force-static'

import { MetadataRoute } from 'next'
import { getSortedPostsData, getAllTags } from '@/lib/posts'
import { getAllDailyDates } from '@/lib/daily'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://mt-github-io.vercel.app'

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getSortedPostsData()
  const tags = getAllTags()

  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}/`,
    lastModified: post.update || post.create,
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  const tagEntries: MetadataRoute.Sitemap = tags.map(({ tag }) => ({
    url: `${BASE_URL}/blog/tags/${encodeURIComponent(tag)}/`,
    changeFrequency: 'weekly',
    priority: 0.5,
  }))

  return [
    {
      url: `${BASE_URL}/`,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${BASE_URL}/blog/page/1/`,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/blog/tags/`,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/note/`,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/note/game/`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/note/webpage-temp/`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/daily/`,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    ...getAllDailyDates().map((date) => ({
      url: `${BASE_URL}/daily/${date}/`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...postEntries,
    ...tagEntries,
  ]
}
