/**
 * 외국 문학 한국어 번역본 크롤링
 * 실행: node scraper_foreign.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 위키문헌 외국 문학 번역본
const novels = [
  // 셰익스피어
  { url: 'https://ko.wikisource.org/wiki/햄릿', title: '햄릿-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/로미오와_줄리엣', title: '로미오와줄리엣-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/맥베스', title: '맥베스-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/오셀로', title: '오셀로-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/리어왕', title: '리어왕-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/한여름_밤의_꿈', title: '한여름밤의꿈-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/베니스의_상인', title: '베니스의상인-셰익스피어' },

  // 생텍쥐페리
  { url: 'https://ko.wikisource.org/wiki/어린_왕자', title: '어린왕자-생텍쥐페리' },

  // 도스토옙스키
  { url: 'https://ko.wikisource.org/wiki/죄와_벌', title: '죄와벌-도스토옙스키' },
  { url: 'https://ko.wikisource.org/wiki/카라마조프가의_형제들', title: '카라마조프가의형제들-도스토옙스키' },
  { url: 'https://ko.wikisource.org/wiki/백치_(소설)', title: '백치-도스토옙스키' },
  { url: 'https://ko.wikisource.org/wiki/지하로부터의_수기', title: '지하로부터의수기-도스토옙스키' },

  // 톨스토이
  { url: 'https://ko.wikisource.org/wiki/안나_카레니나', title: '안나카레니나-톨스토이' },
  { url: 'https://ko.wikisource.org/wiki/전쟁과_평화', title: '전쟁과평화-톨스토이' },
  { url: 'https://ko.wikisource.org/wiki/부활_(소설)', title: '부활-톨스토이' },

  // 괴테
  { url: 'https://ko.wikisource.org/wiki/파우스트', title: '파우스트-괴테' },
  { url: 'https://ko.wikisource.org/wiki/젊은_베르테르의_슬픔', title: '젊은베르테르의슬픔-괴테' },

  // 기타
  { url: 'https://ko.wikisource.org/wiki/변신_(소설)', title: '변신-카프카' },
  { url: 'https://ko.wikisource.org/wiki/노인과_바다', title: '노인과바다-헤밍웨이' },
  { url: 'https://ko.wikisource.org/wiki/위대한_개츠비', title: '위대한개츠비-피츠제럴드' },
  { url: 'https://ko.wikisource.org/wiki/1984_(소설)', title: '1984-조지오웰' },
  { url: 'https://ko.wikisource.org/wiki/동물_농장', title: '동물농장-조지오웰' },
  { url: 'https://ko.wikisource.org/wiki/이방인_(소설)', title: '이방인-카뮈' },
  { url: 'https://ko.wikisource.org/wiki/페스트_(소설)', title: '페스트-카뮈' },
  { url: 'https://ko.wikisource.org/wiki/레_미제라블', title: '레미제라블-빅토르위고' },
  { url: 'https://ko.wikisource.org/wiki/몬테크리스토_백작', title: '몬테크리스토백작-뒤마' },
  { url: 'https://ko.wikisource.org/wiki/삼총사', title: '삼총사-뒤마' },
  { url: 'https://ko.wikisource.org/wiki/돈키호테', title: '돈키호테-세르반테스' },
  { url: 'https://ko.wikisource.org/wiki/오만과_편견', title: '오만과편견-제인오스틴' },
  { url: 'https://ko.wikisource.org/wiki/제인_에어', title: '제인에어-샬럿브론테' },
  { url: 'https://ko.wikisource.org/wiki/폭풍의_언덕', title: '폭풍의언덕-에밀리브론테' },
  { url: 'https://ko.wikisource.org/wiki/보물섬', title: '보물섬-스티븐슨' },
  { url: 'https://ko.wikisource.org/wiki/지킬_박사와_하이드_씨', title: '지킬박사와하이드-스티븐슨' },
  { url: 'https://ko.wikisource.org/wiki/프랑켄슈타인', title: '프랑켄슈타인-메리셸리' },
  { url: 'https://ko.wikisource.org/wiki/드라큘라', title: '드라큘라-브램스토커' },
  { url: 'https://ko.wikisource.org/wiki/그리스인_조르바', title: '그리스인조르바-카잔차키스' },
];

async function scrapeNovel(page, url, title) {
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

    if (content && content.length > 2000) {
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
      const filePath = path.join(outputDir, `${safeTitle}.txt`);
      fs.writeFileSync(filePath, content.trim(), 'utf-8');
      console.log(`  ✓ ${content.length}자`);
      return true;
    } else {
      console.log(`  ✗ 내용 부족 (${content?.length || 0}자)`);
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

  for (const novel of novels) {
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      skip++;
      continue;
    }

    const result = await scrapeNovel(page, novel.url, novel.title);
    if (result) success++;
    else fail++;

    await page.waitForTimeout(1000);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`\n총 ${files.length}개 소설 파일`);
}

main().catch(console.error);
