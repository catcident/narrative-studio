/**
 * 외국 문학 한국어 번역본 추가 크롤링
 * 실행: node scraper_foreign2.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 위키문헌 - 전문이 있는 외국 작품들
const novels = [
  // 셰익스피어 - 다른 URL 시도
  { url: 'https://ko.wikisource.org/wiki/햄릿_(현철_역)', title: '햄릿-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/로미오와_줄리엣_(현철_역)', title: '로미오와줄리엣-셰익스피어' },
  { url: 'https://ko.wikisource.org/wiki/베니스의_상인_(현철_역)', title: '베니스의상인-셰익스피어' },

  // 톨스토이
  { url: 'https://ko.wikisource.org/wiki/사람은_무엇으로_사는가', title: '사람은무엇으로사는가-톨스토이' },
  { url: 'https://ko.wikisource.org/wiki/바보_이반', title: '바보이반-톨스토이' },
  { url: 'https://ko.wikisource.org/wiki/세_가지_질문', title: '세가지질문-톨스토이' },

  // 체호프
  { url: 'https://ko.wikisource.org/wiki/벚꽃_동산', title: '벚꽃동산-체호프' },
  { url: 'https://ko.wikisource.org/wiki/갈매기_(희곡)', title: '갈매기-체호프' },
  { url: 'https://ko.wikisource.org/wiki/바냐_아저씨', title: '바냐아저씨-체호프' },
  { url: 'https://ko.wikisource.org/wiki/세_자매', title: '세자매-체호프' },

  // 입센
  { url: 'https://ko.wikisource.org/wiki/인형의_집', title: '인형의집-입센' },
  { url: 'https://ko.wikisource.org/wiki/유령_(희곡)', title: '유령-입센' },

  // 기타
  { url: 'https://ko.wikisource.org/wiki/타르튀프', title: '타르튀프-몰리에르' },
  { url: 'https://ko.wikisource.org/wiki/수전노_(희곡)', title: '수전노-몰리에르' },
  { url: 'https://ko.wikisource.org/wiki/피그말리온_(희곡)', title: '피그말리온-버나드쇼' },
  { url: 'https://ko.wikisource.org/wiki/고도를_기다리며', title: '고도를기다리며-베케트' },

  // 소설
  { url: 'https://ko.wikisource.org/wiki/변신_(카프카)', title: '변신-카프카' },
  { url: 'https://ko.wikisource.org/wiki/시골_의사', title: '시골의사-카프카' },
  { url: 'https://ko.wikisource.org/wiki/단식_광대', title: '단식광대-카프카' },

  // 모파상
  { url: 'https://ko.wikisource.org/wiki/비곗덩어리', title: '비곗덩어리-모파상' },
  { url: 'https://ko.wikisource.org/wiki/목걸이_(모파상)', title: '목걸이-모파상' },
  { url: 'https://ko.wikisource.org/wiki/여자의_일생', title: '여자의일생-모파상' },

  // 오 헨리
  { url: 'https://ko.wikisource.org/wiki/마지막_잎새', title: '마지막잎새-오헨리' },
  { url: 'https://ko.wikisource.org/wiki/크리스마스_선물', title: '크리스마스선물-오헨리' },
  { url: 'https://ko.wikisource.org/wiki/경찰과_찬송가', title: '경찰과찬송가-오헨리' },

  // 도일
  { url: 'https://ko.wikisource.org/wiki/주홍색_연구', title: '주홍색연구-코난도일' },
  { url: 'https://ko.wikisource.org/wiki/바스커빌_가문의_개', title: '바스커빌가문의개-코난도일' },

  // 포
  { url: 'https://ko.wikisource.org/wiki/검은_고양이', title: '검은고양이-에드거앨런포' },
  { url: 'https://ko.wikisource.org/wiki/어셔_가문의_몰락', title: '어셔가문의몰락-에드거앨런포' },
  { url: 'https://ko.wikisource.org/wiki/모르그_가의_살인', title: '모르그가의살인-에드거앨런포' },

  // 기타
  { url: 'https://ko.wikisource.org/wiki/크리스마스_캐럴', title: '크리스마스캐럴-디킨스' },
  { url: 'https://ko.wikisource.org/wiki/동물_농장_(소설)', title: '동물농장-조지오웰' },
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

    // 한글이 포함되어 있는지 확인
    const hasKorean = content && /[가-힣]/.test(content);

    if (content && content.length > 2000 && hasKorean) {
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
  console.log(`총 ${files.length}개 소설 파일`);
}

main().catch(console.error);
