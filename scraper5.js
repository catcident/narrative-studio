const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 위키문헌 하위 페이지가 있는 작품들 (장편)
const multiPageNovels = [
  {
    title: '홍길동전-허균',
    baseUrl: 'https://ko.wikisource.org/wiki/홍길동전',
    pages: [''] // 단일 페이지 시도
  },
  {
    title: '무정-이광수',
    baseUrl: 'https://ko.wikisource.org/wiki/무정_(소설)',
    // 무정은 여러 회차로 되어있음
    subpagePattern: '/무정_(소설)/{n}회',
    pageCount: 126
  }
];

// 한국 고전문학 전자도서관 등 다른 소스
const additionalUrls = [
  // 프로젝트 구텐베르크 한국어
  { url: 'https://ko.wikisource.org/wiki/혈의_누', title: '혈의누-이인직' },
  { url: 'https://ko.wikisource.org/wiki/은세계', title: '은세계-이인직' },
  { url: 'https://ko.wikisource.org/wiki/치악산_(소설)', title: '치악산-이인직' },
  { url: 'https://ko.wikisource.org/wiki/귀의_성', title: '귀의성-이인직' },

  // 단편소설
  { url: 'https://ko.wikisource.org/wiki/배따라기', title: '배따라기2-김동인' },
  { url: 'https://ko.wikisource.org/wiki/삼대_(1931년_소설)', title: '삼대-염상섭2' },
];

async function scrapeWikisourceWithSubpages(browser, title, baseUrl, subpagePattern, pageCount) {
  const page = await browser.newPage();
  let fullContent = '';

  console.log(`장편 크롤링 시작: ${title} (${pageCount}회)`);

  for (let i = 1; i <= pageCount; i++) {
    const url = subpagePattern
      ? baseUrl.replace('{n}', i)
      : `${baseUrl}/${i}회`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      const content = await page.evaluate(() => {
        const contentDiv = document.querySelector('.mw-parser-output');
        if (!contentDiv) return '';

        const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint');
        removes.forEach(el => el.remove());

        return contentDiv.innerText;
      });

      if (content && content.length > 100) {
        fullContent += `\n\n=== ${i}회 ===\n\n${content}`;
        if (i % 10 === 0) console.log(`  ${i}/${pageCount}회 완료`);
      }
    } catch (err) {
      // 페이지 없으면 스킵
    }

    await page.waitForTimeout(500);
  }

  await page.close();

  if (fullContent.length > 1000) {
    const filePath = path.join(outputDir, `${title}.txt`);
    fs.writeFileSync(filePath, fullContent.trim(), 'utf-8');
    console.log(`  저장 완료: ${title} (${fullContent.length}자)`);
    return true;
  }

  console.log(`  내용 부족: ${title}`);
  return false;
}

async function scrapeNovel(page, url, title) {
  try {
    console.log(`크롤링 시작: ${title}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const content = await page.evaluate(() => {
      const contentDiv = document.querySelector('.mw-parser-output');
      if (!contentDiv) return null;

      const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint');
      removes.forEach(el => el.remove());

      return contentDiv.innerText;
    });

    if (content && content.length > 500) {
      const filePath = path.join(outputDir, `${title}.txt`);
      fs.writeFileSync(filePath, content.trim(), 'utf-8');
      console.log(`  저장 완료: ${title} (${content.length}자)`);
      return true;
    } else {
      console.log(`  내용 부족: ${title}`);
      return false;
    }
  } catch (err) {
    console.log(`  실패: ${title} - ${err.message}`);
    return false;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let success = 0;
  let fail = 0;

  // 단일 페이지 작품들
  for (const novel of additionalUrls) {
    const filePath = path.join(outputDir, `${novel.title}.txt`);
    if (fs.existsSync(filePath)) {
      console.log(`스킵 (이미 존재): ${novel.title}`);
      continue;
    }

    const result = await scrapeNovel(page, novel.url, novel.title);
    if (result) success++;
    else fail++;

    await page.waitForTimeout(1000);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}`);

  // 최종 파일 목록
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`\n총 ${files.length}개 소설 파일:`);
  files.forEach(f => {
    const stats = fs.statSync(path.join(outputDir, f));
    console.log(`  - ${f} (${Math.round(stats.size/1024)}KB)`);
  });
}

main().catch(console.error);
