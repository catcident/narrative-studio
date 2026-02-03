/**
 * 위키문헌 한국 문학 전체 크롤링
 * 하위 페이지 자동 탐색
 * 실행: node scraper_wikisource_full.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 크롤링 대상 작품들
const novels = [
  // 고전소설
  { url: 'https://ko.wikisource.org/wiki/춘향전_(완판_84장본)', title: '춘향전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/홍길동전_(경판본)', title: '홍길동전-허균' },
  { url: 'https://ko.wikisource.org/wiki/흥부전_(완판)', title: '흥부전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/토끼전_(서울대_규장각본)', title: '토끼전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/장화홍련전_(낙선재본)', title: '장화홍련전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/전우치전', title: '전우치전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/옥루몽', title: '옥루몽-남영로' },
  { url: 'https://ko.wikisource.org/wiki/사씨남정기', title: '사씨남정기-김만중' },
  { url: 'https://ko.wikisource.org/wiki/창선감의록', title: '창선감의록-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/숙향전', title: '숙향전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/숙영낭자전', title: '숙영낭자전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/운영전', title: '운영전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/금오신화', title: '금오신화-김시습' },

  // 근대소설 - 이광수
  { url: 'https://ko.wikisource.org/wiki/무정_(소설)', title: '무정-이광수' },
  { url: 'https://ko.wikisource.org/wiki/흙_(소설)', title: '흙-이광수' },
  { url: 'https://ko.wikisource.org/wiki/재생_(소설)', title: '재생-이광수' },
  { url: 'https://ko.wikisource.org/wiki/유정_(소설)', title: '유정-이광수' },

  // 근대소설 - 기타
  { url: 'https://ko.wikisource.org/wiki/삼대_(소설)', title: '삼대-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/태평천하', title: '태평천하-채만식' },
  { url: 'https://ko.wikisource.org/wiki/탁류', title: '탁류-채만식' },
  { url: 'https://ko.wikisource.org/wiki/만세전_(소설)', title: '만세전-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/상록수_(소설)', title: '상록수-심훈' },
];

async function getSubpageLinks(page, baseUrl) {
  // 목차 페이지에서 하위 페이지 링크 추출
  const links = await page.evaluate((base) => {
    const contentDiv = document.querySelector('.mw-parser-output');
    if (!contentDiv) return [];

    const anchors = contentDiv.querySelectorAll('a');
    const subLinks = [];

    anchors.forEach(a => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('/wiki/') && !href.includes(':')) {
        const fullUrl = 'https://ko.wikisource.org' + href;
        // 같은 작품의 하위 페이지인지 확인
        if (fullUrl.startsWith(base) || href.includes('/1') || href.includes('/2')) {
          subLinks.push(fullUrl);
        }
      }
    });

    return [...new Set(subLinks)];
  }, baseUrl);

  return links;
}

async function scrapeNovel(browser, url, title) {
  const page = await browser.newPage();
  let fullContent = '';

  console.log(`\n크롤링 시작: ${title}`);
  console.log(`  URL: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 1. 먼저 메인 페이지 내용 확인
    const mainContent = await page.evaluate(() => {
      const contentDiv = document.querySelector('.mw-parser-output');
      if (!contentDiv) return '';

      const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint');
      removes.forEach(el => el.remove());

      return contentDiv.innerText;
    });

    // 메인 페이지 내용이 충분하면 그대로 사용
    if (mainContent.length > 5000) {
      fullContent = mainContent;
      console.log(`  메인 페이지: ${mainContent.length}자`);
    } else {
      // 2. 하위 페이지 크롤링 시도
      console.log(`  하위 페이지 탐색 중...`);

      // /1, /2, /3... 형태로 시도
      for (let i = 1; i <= 200; i++) {
        const subUrl = `${url}/${i}`;

        try {
          const response = await page.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

          if (response.status() === 404) break;

          const pageTitle = await page.title();
          if (pageTitle.includes('찾을 수 없습니다') || pageTitle.includes('존재하지 않')) break;

          const content = await page.evaluate(() => {
            const contentDiv = document.querySelector('.mw-parser-output');
            if (!contentDiv) return '';

            const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint');
            removes.forEach(el => el.remove());

            return contentDiv.innerText;
          });

          if (content && content.length > 50) {
            fullContent += `\n\n=== ${i} ===\n\n${content}`;
            if (i % 20 === 0) process.stdout.write(`${i}...`);
          } else {
            break;
          }
        } catch (err) {
          break;
        }

        await page.waitForTimeout(200);
      }

      console.log(`\n  하위 페이지에서 ${fullContent.length}자 수집`);
    }

  } catch (err) {
    console.log(`  에러: ${err.message}`);
  }

  await page.close();

  if (fullContent.length > 1000) {
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);
    fs.writeFileSync(filePath, fullContent.trim(), 'utf-8');
    console.log(`  ✓ 저장 완료: ${safeTitle}.txt (${fullContent.length}자)`);
    return true;
  }

  console.log(`  ✗ 내용 부족 (${fullContent.length}자)`);
  return false;
}

async function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  let success = 0;
  let fail = 0;
  let skip = 0;

  for (const novel of novels) {
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size > 1000) {
        console.log(`\n스킵 (이미 존재): ${novel.title}`);
        skip++;
        continue;
      }
    }

    const result = await scrapeNovel(browser, novel.url, novel.title);
    if (result) success++;
    else fail++;

    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  console.log('\n========================================');
  console.log(`완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);
  console.log('========================================\n');

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 소설 파일:`);
  files.sort().forEach(f => {
    const stats = fs.statSync(path.join(outputDir, f));
    console.log(`  ${f} (${Math.round(stats.size/1024)}KB)`);
  });
}

main().catch(console.error);
