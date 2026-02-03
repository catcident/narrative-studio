/**
 * 셰익스피어 이야기 크롤링 (찰스 램 & 메리 램 번역)
 * 실행: node scraper_shakespeare.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 셰익스피어 이야기 - 위키문헌 번역본
const stories = [
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/리어왕', title: '리어왕이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/맥베스', title: '맥베스이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/오셀로', title: '오셀로이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/햄릿', title: '햄릿이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/로미오와_줄리엣', title: '로미오와줄리엣이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/베니스의_상인', title: '베니스의상인이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/한여름_밤의_꿈', title: '한여름밤의꿈이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/템페스트', title: '템페스트이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/말괄량이_길들이기', title: '말괄량이길들이기이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/뜻대로_하세요', title: '뜻대로하세요이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/십이야', title: '십이야이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/겨울_이야기', title: '겨울이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/심벨린', title: '심벨린이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/페리클레스', title: '페리클레스이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/실수_연발', title: '실수연발이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/헛소동', title: '헛소동이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/끝이_좋으면_다_좋아', title: '끝이좋으면다좋아이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/자에는_자로', title: '자에는자로이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/타이몬', title: '타이몬이야기-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/번역:셰익스피어_이야기/두_베로나_신사', title: '두베로나신사이야기-셰익스피어' },
];

async function scrapeStory(page, url, title) {
  try {
    console.log(`크롤링: ${title}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const content = await page.evaluate(() => {
      const contentDiv = document.querySelector('.mw-parser-output');
      if (!contentDiv) return null;

      const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint, .catlinks, .sistersitebox');
      removes.forEach(el => el.remove());

      return contentDiv.innerText;
    });

    // 한글이 포함되어 있는지 확인
    const hasKorean = content && /[가-힣]/.test(content);

    if (content && content.length > 1000 && hasKorean) {
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
      const filePath = path.join(outputDir, `${safeTitle}.txt`);
      fs.writeFileSync(filePath, content.trim(), 'utf-8');
      console.log(`  ✓ ${content.length}자`);
      return true;
    } else {
      console.log(`  ✗ 내용 부족 또는 한글 없음 (${content?.length || 0}자)`);
      return false;
    }
  } catch (err) {
    console.log(`  ✗ 에러: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let success = 0;
  let fail = 0;
  let skip = 0;

  for (const story of stories) {
    const safeTitle = story.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      console.log(`스킵 (이미 존재): ${story.title}`);
      skip++;
      continue;
    }

    const result = await scrapeStory(page, story.url, story.title);
    if (result) success++;
    else fail++;

    await page.waitForTimeout(800);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 소설 파일`);
}

main().catch(console.error);
