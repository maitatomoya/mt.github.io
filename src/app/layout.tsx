import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://mt-github-io.mt114r-an.workers.dev'

export const metadata: Metadata = {
  title: {
    default: 'Maita Tomoya Dev IO',
    template: '%s - Maita Tomoya Dev IO',
  },
  description: '技術記事や学習記録を掲載しています。',
  metadataBase: new URL(BASE_URL),
  openGraph: {
    title: 'Maita Tomoya Dev IO',
    description: '技術記事や学習記録を掲載しています。',
    url: BASE_URL,
    siteName: 'Maita Tomoya Dev IO',
    locale: 'ja_JP',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Maita Tomoya Dev IO',
    description: '技術記事や学習記録を掲載しています。',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
