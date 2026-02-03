/**
 * 한국 소설 크롤링 스크립트
 * 실행: node scraper_all.js
 *
 * 이 스크립트를 계속 돌리시면 됩니다.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 크롤링할 작품 목록 - 위키문헌
const novelUrls = [
  // 위키문헌 한국 고전소설/근대소설
  { url: 'https://ko.wikisource.org/wiki/홍길동전_(경판본)', title: '홍길동전-허균' },
  { url: 'https://ko.wikisource.org/wiki/춘향전_(완판_84장본)', title: '춘향전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/흥부전_(완판)', title: '흥부전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/토끼전_(서울대_규장각본)', title: '토끼전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/장화홍련전_(낙선재본)', title: '장화홍련전-작자미상' },

  // 이인직 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/모란봉_(소설)', title: '모란봉-이인직' },

  // 이광수 작품
  { url: 'https://ko.wikisource.org/wiki/어린_희생', title: '어린희생-이광수' },
  { url: 'https://ko.wikisource.org/wiki/무명', title: '무명-이광수' },
  { url: 'https://ko.wikisource.org/wiki/꿈_(이광수)', title: '꿈-이광수' },
  { url: 'https://ko.wikisource.org/wiki/흙_(소설)', title: '흙-이광수' },

  // 김동인 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/감자', title: '감자-김동인' },
  { url: 'https://ko.wikisource.org/wiki/약한_자의_슬픔', title: '약한자의슬픔-김동인' },
  { url: 'https://ko.wikisource.org/wiki/명문', title: '명문-김동인' },
  { url: 'https://ko.wikisource.org/wiki/젊은_그들', title: '젊은그들-김동인' },
  { url: 'https://ko.wikisource.org/wiki/K_박사의_연구', title: 'K박사의연구-김동인' },

  // 현진건 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/고향_(현진건)', title: '고향-현진건' },
  { url: 'https://ko.wikisource.org/wiki/불_(현진건)', title: '불-현진건' },
  { url: 'https://ko.wikisource.org/wiki/사립정신병원장', title: '사립정신병원장-현진건' },

  // 나도향 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/뽕', title: '뽕-나도향' },
  { url: 'https://ko.wikisource.org/wiki/환희', title: '환희-나도향' },

  // 염상섭 작품
  { url: 'https://ko.wikisource.org/wiki/표본실의_청개구리', title: '표본실의청개구리-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/만세전_(소설)', title: '만세전-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/두_파산', title: '두파산-염상섭' },

  // 채만식 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/태평천하', title: '태평천하-채만식' },
  { url: 'https://ko.wikisource.org/wiki/치숙', title: '치숙-채만식' },

  // 김유정 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/금따는_콩밭', title: '금따는콩밭-김유정' },
  { url: 'https://ko.wikisource.org/wiki/만무방', title: '만무방-김유정' },
  { url: 'https://ko.wikisource.org/wiki/소낙비_(김유정)', title: '소낙비-김유정' },

  // 이효석 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/돈_(이효석)', title: '돈-이효석' },
  { url: 'https://ko.wikisource.org/wiki/분녀', title: '분녀-이효석' },

  // 이상 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/봉별기', title: '봉별기-이상' },
  { url: 'https://ko.wikisource.org/wiki/종생기', title: '종생기-이상' },
  { url: 'https://ko.wikisource.org/wiki/지주회시', title: '지주회시-이상' },

  // 최서해 작품 (이미 있는 것 제외)
  { url: 'https://ko.wikisource.org/wiki/홍염', title: '홍염-최서해' },
  { url: 'https://ko.wikisource.org/wiki/기아와_살육', title: '기아와살육-최서해' },

  // 기타 작가
  { url: 'https://ko.wikisource.org/wiki/운현궁의_봄', title: '운현궁의봄-김동인' },
  { url: 'https://ko.wikisource.org/wiki/삼포_가는_길', title: '삼포가는길-황석영' },
  { url: 'https://ko.wikisource.org/wiki/비오는_날', title: '비오는날-손창섭' },
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
      const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint, .catlinks, .sistersitebox');
      removes.forEach(el => el.remove());

      return contentDiv.innerText;
    });

    if (content && content.length > 500) {
      // 파일명에서 특수문자 제거
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
      const filePath = path.join(outputDir, `${safeTitle}.txt`);
      fs.writeFileSync(filePath, content.trim(), 'utf-8');
      console.log(`  ✓ 저장 완료: ${title} (${content.length}자)`);
      return true;
    } else {
      console.log(`  ✗ 내용 부족: ${title} (${content?.length || 0}자)`);
      return false;
    }
  } catch (err) {
    console.log(`  ✗ 실패: ${title} - ${err.message}`);
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

  for (const novel of novelUrls) {
    // 이미 존재하는 파일 스킵
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);
    if (fs.existsSync(filePath)) {
      console.log(`스킵 (이미 존재): ${novel.title}`);
      skip++;
      continue;
    }

    const result = await scrapeNovel(page, novel.url, novel.title);
    if (result) success++;
    else fail++;

    // 딜레이
    await page.waitForTimeout(1500);
  }

  await browser.close();

  console.log('\n========================================');
  console.log(`완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);
  console.log('========================================\n');

  // 최종 파일 목록
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 소설 파일:`);
  files.forEach(f => {
    const stats = fs.statSync(path.join(outputDir, f));
    console.log(`  - ${f} (${Math.round(stats.size/1024)}KB)`);
  });
}

main().catch(console.error);
