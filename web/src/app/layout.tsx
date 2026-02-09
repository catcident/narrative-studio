import './globals.css'
import { AuthProvider } from '@/components/AuthProvider'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL('https://storygraph.catcident.com'),
  title: '스토리그래프 - AI 인물 관계도',
  description: 'AI가 소설을 분석하여 인물 관계를 시각화합니다',
  openGraph: {
    title: '스토리그래프 - AI 인물 관계도',
    description: 'AI가 소설을 분석하여 인물 관계를 시각화합니다',
    type: 'website',
    url: 'https://storygraph.catcident.com',
    siteName: '스토리그래프',
    locale: 'ko_KR',
  },
  twitter: {
    card: 'summary_large_image',
    title: '스토리그래프 - AI 인물 관계도',
    description: 'AI가 소설을 분석하여 인물 관계를 시각화합니다',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
