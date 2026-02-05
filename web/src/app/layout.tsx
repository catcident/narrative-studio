import './globals.css'
import { AuthProvider } from '@/components/AuthProvider'

export const metadata = {
  title: '인물 관계도',
  description: '소설 인물 관계 분석기',
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
