const LEGAL_LINKS = [
  { label: '이용약관', href: 'https://catcident.com/ko/terms/' },
  { label: '개인정보처리방침', href: 'https://catcident.com/ko/privacy/' },
] as const;

export function Footer() {
  return (
    <footer className="mt-auto w-full py-16 px-6">
      <div className="max-w-5xl mx-auto flex flex-col items-center gap-3">
        <a
          href="https://catcident.com"
          target="_blank"
          rel="noopener"
          className="text-sm font-semibold text-gray-400 hover:text-gray-600 tracking-tight transition-colors"
        >
          고양이의 만행
        </a>

        <div className="flex items-center gap-3 text-xs text-gray-300">
          {LEGAL_LINKS.map((link, i) => (
            <span key={link.label} className="flex items-center gap-3">
              {i > 0 && <span aria-hidden="true" className="text-gray-200">·</span>}
              <a
                href={link.href}
                target="_blank"
                rel="noopener"
                className="hover:text-gray-500 transition-colors"
              >
                {link.label}
              </a>
            </span>
          ))}
        </div>

        <p className="text-[11px] text-gray-300">&copy; 2026 고양이의 만행</p>
      </div>
    </footer>
  );
}
