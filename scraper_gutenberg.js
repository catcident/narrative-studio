/**
 * 프로젝트 구텐베르크 한국어 작품 크롤링
 * 실행: node scraper_gutenberg.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 프로젝트 구텐베르크 한국어 작품
const novels = [
  // 구텐베르크에서 한국어로 된 것들
  { url: 'https://www.gutenberg.org/cache/epub/70267/pg70267.txt', title: '어린왕자-생텍쥐페리' },
];

// 위키문헌에서 하위 페이지 형태 작품 크롤링
const wikisourceNovels = [
  { baseUrl: 'https://ko.wikisource.org/wiki/위대한_개츠비', title: '위대한개츠비-피츠제럴드', chapters: 9 },
];

async function fetchGutenberg(url, title) {
  try {
    console.log(`구텐베르크 크롤링: ${title}`);
    const response = await fetch(url);
    const text = await response.text();

    if (text && text.length > 5000) {
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
      const filePath = path.join(outputDir, `${safeTitle}.txt`);
      fs.writeFileSync(filePath, text.trim(), 'utf-8');
      console.log(`  ✓ ${text.length}자`);
      return true;
    }
    console.log(`  ✗ 내용 부족`);
    return false;
  } catch (err) {
    console.log(`  ✗ 에러: ${err.message}`);
    return false;
  }
}

async function scrapeWikisourceChapters(browser, baseUrl, title, chapters) {
  const page = await browser.newPage();
  let fullContent = '';

  console.log(`\n위키문헌 크롤링: ${title} (${chapters}장)`);

  for (let i = 1; i <= chapters; i++) {
    const url = `${baseUrl}/제${i}장`;

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
        fullContent += `\n\n=== 제${i}장 ===\n\n${content}`;
        process.stdout.write(`${i}...`);
      }
    } catch (err) {
      // 페이지 없으면 스킵
    }

    await page.waitForTimeout(500);
  }

  await page.close();
  console.log();

  if (fullContent.length > 5000) {
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);
    fs.writeFileSync(filePath, fullContent.trim(), 'utf-8');
    console.log(`  ✓ ${fullContent.length}자`);
    return true;
  }

  console.log(`  ✗ 내용 부족 (${fullContent.length}자)`);
  return false;
}

async function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let success = 0;

  // 구텐베르크 크롤링
  for (const novel of novels) {
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      console.log(`스킵 (이미 존재): ${novel.title}`);
      continue;
    }

    const result = await fetchGutenberg(novel.url, novel.title);
    if (result) success++;
  }

  // 위키문헌 장별 크롤링
  const browser = await chromium.launch({ headless: true });

  for (const novel of wikisourceNovels) {
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      console.log(`스킵 (이미 존재): ${novel.title}`);
      continue;
    }

    const result = await scrapeWikisourceChapters(browser, novel.baseUrl, novel.title, novel.chapters);
    if (result) success++;
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}`);

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 소설 파일`);
}

main().catch(console.error);
