const FOOTER_SECTIONS = [
  {
    title: '서비스',
    links: [
      { label: '기능 소개', href: '/#features' },
      { label: '요금제', href: '/#pricing' },
    ],
  },
  {
    title: '고양이의 만행',
    links: [
      { label: '홈페이지', href: 'https://catcident.com', external: true },
      { label: '뉴스', href: 'https://catcident.com/ko/news/', external: true },
    ],
  },
  {
    title: '법적 정보',
    links: [
      { label: '이용약관', href: 'https://catcident.com/ko/terms/', external: true },
      { label: '개인정보처리방침', href: 'https://catcident.com/ko/privacy/', external: true },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white mt-auto">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">{section.title}</h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...('external' in link && link.external ? { target: '_blank', rel: 'noopener' } : {})}
                      className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 pt-6 border-t border-gray-100 text-center text-xs text-gray-400">
          &copy; 2026 고양이의 만행. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
