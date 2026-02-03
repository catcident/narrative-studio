/**
 * 추가 한국 문학 크롤링
 * 실행: node scraper_more.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 위키문헌에서 본문이 있는 작품들
const novels = [
  // 단편소설 - 본문이 한 페이지에 있는 것들
  { url: 'https://ko.wikisource.org/wiki/감자_(소설)', title: '감자-김동인' },
  { url: 'https://ko.wikisource.org/wiki/배따라기_(소설)', title: '배따라기2-김동인' },
  { url: 'https://ko.wikisource.org/wiki/명문_(소설)', title: '명문-김동인' },
  { url: 'https://ko.wikisource.org/wiki/약한_자의_슬픔', title: '약한자의슬픔-김동인' },
  { url: 'https://ko.wikisource.org/wiki/붉은_산', title: '붉은산-김동인' },
  { url: 'https://ko.wikisource.org/wiki/태형', title: '태형-김동인' },
  { url: 'https://ko.wikisource.org/wiki/발가락이_닮았다', title: '발가락이닮았다-김동인' },

  { url: 'https://ko.wikisource.org/wiki/사립정신병원장', title: '사립정신병원장-현진건' },
  { url: 'https://ko.wikisource.org/wiki/고향_(현진건)', title: '고향-현진건' },
  { url: 'https://ko.wikisource.org/wiki/정조와_약가', title: '정조와약가-현진건' },

  { url: 'https://ko.wikisource.org/wiki/뽕_(소설)', title: '뽕-나도향' },
  { url: 'https://ko.wikisource.org/wiki/환희_(소설)', title: '환희-나도향' },
  { url: 'https://ko.wikisource.org/wiki/지형근', title: '지형근-나도향' },

  { url: 'https://ko.wikisource.org/wiki/금_따는_콩밭', title: '금따는콩밭-김유정' },
  { url: 'https://ko.wikisource.org/wiki/만무방_(소설)', title: '만무방-김유정' },
  { url: 'https://ko.wikisource.org/wiki/땡볕', title: '땡볕-김유정' },
  { url: 'https://ko.wikisource.org/wiki/산골_나그네', title: '산골나그네-김유정' },
  { url: 'https://ko.wikisource.org/wiki/소낙비_(김유정)', title: '소낙비-김유정' },

  { url: 'https://ko.wikisource.org/wiki/돈_(이효석)', title: '돈-이효석' },
  { url: 'https://ko.wikisource.org/wiki/분녀', title: '분녀-이효석' },
  { url: 'https://ko.wikisource.org/wiki/도시와_유령', title: '도시와유령-이효석' },
  { url: 'https://ko.wikisource.org/wiki/들', title: '들-이효석' },

  { url: 'https://ko.wikisource.org/wiki/봉별기', title: '봉별기-이상' },
  { url: 'https://ko.wikisource.org/wiki/종생기', title: '종생기-이상' },
  { url: 'https://ko.wikisource.org/wiki/지주회시', title: '지주회시-이상' },
  { url: 'https://ko.wikisource.org/wiki/동해_(이상)', title: '동해-이상' },

  { url: 'https://ko.wikisource.org/wiki/홍염_(소설)', title: '홍염-최서해' },
  { url: 'https://ko.wikisource.org/wiki/기아와_살육', title: '기아와살육-최서해' },
  { url: 'https://ko.wikisource.org/wiki/고국', title: '고국-최서해' },

  { url: 'https://ko.wikisource.org/wiki/표본실의_청개구리', title: '표본실의청개구리-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/두_파산', title: '두파산-염상섭' },
  { url: 'https://ko.wikisource.org/wiki/전화', title: '전화-염상섭' },

  { url: 'https://ko.wikisource.org/wiki/치숙', title: '치숙-채만식' },
  { url: 'https://ko.wikisource.org/wiki/미스터_방', title: '미스터방-채만식' },

  // 고전소설 - 본문이 있는 것들
  { url: 'https://ko.wikisource.org/wiki/홍길동전', title: '홍길동전-허균2' },
  { url: 'https://ko.wikisource.org/wiki/춘향전', title: '춘향전-작자미상2' },
  { url: 'https://ko.wikisource.org/wiki/심청전', title: '심청전-작자미상2' },
  { url: 'https://ko.wikisource.org/wiki/흥부전', title: '흥부전-작자미상2' },
  { url: 'https://ko.wikisource.org/wiki/별주부전', title: '별주부전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/허생전', title: '허생전-박지원' },
  { url: 'https://ko.wikisource.org/wiki/호질', title: '호질-박지원' },
  { url: 'https://ko.wikisource.org/wiki/양반전', title: '양반전-박지원' },
  { url: 'https://ko.wikisource.org/wiki/광문자전', title: '광문자전-박지원' },
  { url: 'https://ko.wikisource.org/wiki/민옹전', title: '민옹전-박지원' },
  { url: 'https://ko.wikisource.org/wiki/마장전', title: '마장전-박지원' },
  { url: 'https://ko.wikisource.org/wiki/예덕선생전', title: '예덕선생전-박지원' },
  { url: 'https://ko.wikisource.org/wiki/김신선전', title: '김신선전-박지원' },

  // 이인직
  { url: 'https://ko.wikisource.org/wiki/혈의_누', title: '혈의누-이인직2' },

  // 이광수 단편
  { url: 'https://ko.wikisource.org/wiki/무명_(이광수)', title: '무명-이광수' },
  { url: 'https://ko.wikisource.org/wiki/어린_희생', title: '어린희생-이광수' },
  { url: 'https://ko.wikisource.org/wiki/소년의_비애', title: '소년의비애-이광수' },
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

    if (content && content.length > 1000) {
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

    await page.waitForTimeout(800);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`\n총 ${files.length}개 소설 파일`);
}

main().catch(console.error);
