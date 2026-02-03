const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 추가로 크롤링할 작품들
const novelUrls = [
  // 위키문헌 한국 고전소설
  { url: 'https://ko.wikisource.org/wiki/홍길동전', title: '홍길동전-허균' },
  { url: 'https://ko.wikisource.org/wiki/춘향전', title: '춘향전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/흥부전', title: '흥부전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/장화홍련전', title: '장화홍련전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/토끼전', title: '토끼전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/콩쥐팥쥐', title: '콩쥐팥쥐-작자미상' },

  // 근대소설 추가
  { url: 'https://ko.wikisource.org/wiki/삼대_(소설)', title: '삼대-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/무정_(소설)', title: '무정-이광수' },
  { url: 'https://ko.wikisource.org/wiki/감자_(소설)', title: '감자-김동인' },
  { url: 'https://ko.wikisource.org/wiki/고향_(소설)', title: '고향-이기영' },
  { url: 'https://ko.wikisource.org/wiki/만세전', title: '만세전-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/탁류', title: '탁류-채만식' },
  { url: 'https://ko.wikisource.org/wiki/태평천하', title: '태평천하-채만식' },
  { url: 'https://ko.wikisource.org/wiki/상록수_(소설)', title: '상록수-심훈' },
  { url: 'https://ko.wikisource.org/wiki/인간문제', title: '인간문제-강경애' },
];

async function scrapeNovel(page, url, title) {
  try {
    console.log(`크롤링 시작: ${title}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 본문 추출
    const content = await page.evaluate(() => {
      const contentDiv = document.querySelector('.mw-parser-output');
      if (!contentDiv) return null;

      // 불필요한 요소 제거
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

  for (const novel of novelUrls) {
    // 이미 존재하는 파일 스킵
    const filePath = path.join(outputDir, `${novel.title}.txt`);
    if (fs.existsSync(filePath)) {
      console.log(`스킵 (이미 존재): ${novel.title}`);
      continue;
    }

    const result = await scrapeNovel(page, novel.url, novel.title);
    if (result) success++;
    else fail++;

    // 딜레이
    await page.waitForTimeout(1000);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}`);

  // 최종 파일 목록
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`\n총 ${files.length}개 소설 파일:`);
  files.forEach(f => console.log(`  - ${f}`));
}

main().catch(console.error);
