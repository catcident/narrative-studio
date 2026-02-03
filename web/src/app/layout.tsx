import './globals.css'
import { AUTH_ENABLED } from '@/lib/auth'
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
        {AUTH_ENABLED ? <AuthProvider>{children}</AuthProvider> : children}
      </body>
    </html>
  )
}
