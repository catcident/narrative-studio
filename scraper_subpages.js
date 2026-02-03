/**
 * 하위 페이지가 있는 작품 크롤링
 * 실행: node scraper_subpages.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 하위 페이지가 있는 작품들
const multiPageNovels = [
  { baseUrl: 'https://ko.wikisource.org/wiki/춘향전_(완판_84장본)', title: '춘향전-작자미상', maxPages: 100 },
  { baseUrl: 'https://ko.wikisource.org/wiki/흥부전_(완판)', title: '흥부전-작자미상', maxPages: 50 },
  { baseUrl: 'https://ko.wikisource.org/wiki/토끼전_(서울대_규장각본)', title: '토끼전-작자미상', maxPages: 50 },
  { baseUrl: 'https://ko.wikisource.org/wiki/홍길동전_(경판본)', title: '홍길동전-허균', maxPages: 50 },
  { baseUrl: 'https://ko.wikisource.org/wiki/장화홍련전_(낙선재본)', title: '장화홍련전-작자미상', maxPages: 50 },
  { baseUrl: 'https://ko.wikisource.org/wiki/무정_(소설)', title: '무정-이광수', maxPages: 130 },
  { baseUrl: 'https://ko.wikisource.org/wiki/흙_(소설)', title: '흙-이광수', maxPages: 100 },
  { baseUrl: 'https://ko.wikisource.org/wiki/삼대_(소설)', title: '삼대-염상섭', maxPages: 100 },
  { baseUrl: 'https://ko.wikisource.org/wiki/태평천하', title: '태평천하-채만식', maxPages: 50 },
  { baseUrl: 'https://ko.wikisource.org/wiki/만세전_(소설)', title: '만세전-염상섭', maxPages: 50 },
];

async function scrapeMultiPageNovel(browser, baseUrl, title, maxPages) {
  const page = await browser.newPage();
  let fullContent = '';
  let successPages = 0;

  console.log(`\n크롤링 시작: ${title}`);

  for (let i = 1; i <= maxPages; i++) {
    const url = `${baseUrl}/${i}`;

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // 404면 종료
      if (response.status() === 404) {
        break;
      }

      const content = await page.evaluate(() => {
        const contentDiv = document.querySelector('.mw-parser-output');
        if (!contentDiv) return '';

        const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint, .catlinks');
        removes.forEach(el => el.remove());

        return contentDiv.innerText;
      });

      if (content && content.length > 100) {
        fullContent += `\n\n=== ${i} ===\n\n${content}`;
        successPages++;
        if (i % 10 === 0) {
          process.stdout.write(`  ${i}페이지... `);
        }
      }
    } catch (err) {
      // 페이지 없으면 종료
      if (err.message.includes('404') || err.message.includes('timeout')) {
        break;
      }
    }

    await page.waitForTimeout(300);
  }

  await page.close();

  console.log(`\n  총 ${successPages}페이지 수집 (${fullContent.length}자)`);

  if (fullContent.length > 1000) {
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);
    fs.writeFileSync(filePath, fullContent.trim(), 'utf-8');
    console.log(`  ✓ 저장 완료: ${title}`);
    return true;
  }

  console.log(`  ✗ 내용 부족`);
  return false;
}

async function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  let success = 0;
  let skip = 0;

  for (const novel of multiPageNovels) {
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      console.log(`\n스킵 (이미 존재): ${novel.title}`);
      skip++;
      continue;
    }

    const result = await scrapeMultiPageNovel(browser, novel.baseUrl, novel.title, novel.maxPages);
    if (result) success++;
  }

  await browser.close();

  console.log('\n========================================');
  console.log(`완료: 성공 ${success}, 스킵 ${skip}`);
  console.log('========================================\n');

  // 최종 파일 목록
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 소설 파일`);
}

main().catch(console.error);
