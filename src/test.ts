/**
 * 테스트 스크립트
 * API 키 없이 하이퍼그래프 모델만 테스트
 */

import { HyperGraph } from './models/hypergraph.js';

console.log('='.repeat(50));
console.log('하이퍼그래프 모델 테스트');
console.log('='.repeat(50));

// 1. 그래프 생성
const graph = new HyperGraph('마법사의 여정', '테스트 작가');
console.log('\n✅ 그래프 생성됨');

// 2. 엔티티 추가
console.log('\n📝 엔티티 추가 중...');

const arrin = graph.addEntity('아린', 'character', {
  aliases: ['붉은 마법사', '불꽃의 아린'],
  description: '주인공. 화염 마법을 다루는 젊은 마법사.',
  attributes: {
    age: 22,
    gender: '여성',
    occupation: '마법사',
    specialty: '화염 마법',
  },
});
console.log(`   - ${arrin.name} (${arrin.id})`);

const kaien = graph.addEntity('카이엔', 'character', {
  aliases: ['검은 기사'],
  description: '아린의 동료. 검술의 달인.',
  attributes: {
    age: 25,
    gender: '남성',
    occupation: '기사',
  },
});
console.log(`   - ${kaien.name} (${kaien.id})`);

const darkLord = graph.addEntity('마왕 벨제부르', 'character', {
  aliases: ['어둠의 군주', '벨제부르'],
  description: '주적. 어둠의 힘을 다루는 마왕.',
  attributes: {
    age: '불명',
    gender: '남성',
    race: '마족',
  },
});
console.log(`   - ${darkLord.name} (${darkLord.id})`);

const magicGuild = graph.addEntity('화염 길드', 'organization', {
  description: '아린이 소속된 마법사 길드',
});
console.log(`   - ${magicGuild.name} (${magicGuild.id})`);

const capital = graph.addEntity('왕도 카르테아', 'location', {
  description: '왕국의 수도. 화염 길드 본부가 있음.',
  attributes: {
    type: '도시',
    population: '50만',
  },
});
console.log(`   - ${capital.name} (${capital.id})`);

const darkCastle = graph.addEntity('어둠의 성', 'location', {
  description: '마왕이 거주하는 성',
  attributes: {
    type: '성채',
    region: '북부 황무지',
  },
});
console.log(`   - ${darkCastle.name} (${darkCastle.id})`);

const holyBlade = graph.addEntity('성검 루미나', 'item', {
  description: '빛의 힘을 담은 전설의 검',
  attributes: {
    type: '무기',
    power: '어둠 퇴치',
  },
});
console.log(`   - ${holyBlade.name} (${holyBlade.id})`);

const war = graph.addEntity('마왕 전쟁', 'event', {
  description: '5년 전 발생한 마왕과의 대전쟁',
});
console.log(`   - ${war.name} (${war.id})`);

const timePeriod = graph.addEntity('왕력 127년', 'time_period', {
  description: '현재 시점',
});
console.log(`   - ${timePeriod.name} (${timePeriod.id})`);

// 3. 하이퍼엣지 추가 (관계)
console.log('\n🔗 관계 추가 중...');

const edge1 = graph.addHyperEdge(
  'friendship',
  [arrin.id, kaien.id],
  '아린과 카이엔은 어릴 적부터 함께 자란 소꿉친구이다.',
  {
    sentiment: 'positive',
    strength: 9,
    timeline: { start: '어린 시절', chapter: 1 },
  }
);
console.log(`   - ${edge1?.id}: 아린-카이엔 우정`);

const edge2 = graph.addHyperEdge(
  'rivalry',
  [arrin.id, darkLord.id],
  '아린은 마왕 벨제부르를 물리치기 위해 모험을 떠났다.',
  {
    sentiment: 'negative',
    strength: 10,
    timeline: { start: '왕력 127년 봄', chapter: 1 },
  }
);
console.log(`   - ${edge2?.id}: 아린-마왕 적대`);

const edge3 = graph.addHyperEdge(
  'belongs_to',
  [arrin.id, magicGuild.id],
  '아린은 화염 길드의 정식 마법사이다.',
  {
    timeline: { start: '왕력 120년', chapter: 1 },
  }
);
console.log(`   - ${edge3?.id}: 아린-화염길드 소속`);

const edge4 = graph.addHyperEdge(
  'located_at',
  [magicGuild.id, capital.id],
  '화염 길드의 본부는 왕도 카르테아에 위치한다.',
  {}
);
console.log(`   - ${edge4?.id}: 화염길드-왕도 위치`);

const edge5 = graph.addHyperEdge(
  'rules',
  [darkLord.id, darkCastle.id],
  '마왕 벨제부르는 어둠의 성을 거점으로 삼고 있다.',
  {}
);
console.log(`   - ${edge5?.id}: 마왕-어둠의성 지배`);

const edge6 = graph.addHyperEdge(
  'owns',
  [kaien.id, holyBlade.id],
  '카이엔은 성검 루미나의 소유자이다.',
  {
    timeline: { start: '마왕 전쟁 이후', chapter: 1 },
  }
);
console.log(`   - ${edge6?.id}: 카이엔-성검 소유`);

// 3개 이상 연결하는 하이퍼엣지
const edge7 = graph.addHyperEdge(
  'participates',
  [arrin.id, kaien.id, war.id],
  '아린과 카이엔은 5년 전 마왕 전쟁에 함께 참전했다.',
  {
    timeline: { start: '왕력 122년', chapter: 1 },
  }
);
console.log(`   - ${edge7?.id}: 아린,카이엔 마왕전쟁 참전 (3개 연결)`);

const edge8 = graph.addHyperEdge(
  'occurred_at',
  [war.id, capital.id, timePeriod.id],
  '마왕 전쟁의 최종 전투는 왕력 122년 왕도에서 벌어졌다.',
  {
    timeline: { start: '왕력 122년', chapter: 1 },
  }
);
console.log(`   - ${edge8?.id}: 마왕전쟁-왕도-시간 (3개 연결)`);

// 4. 타임라인 추가
console.log('\n📅 타임라인 추가 중...');

const t1 = graph.addTimelinePoint(
  '마왕 전쟁',
  '왕력 122년',
  [arrin.id, kaien.id, darkLord.id, war.id],
  {
    description: '마왕과의 대전쟁. 많은 희생 끝에 일시적 승리.',
    chapter: 1,
  }
);
console.log(`   - ${t1.id}: ${t1.name}`);

const t2 = graph.addTimelinePoint(
  '현재 시점',
  '왕력 127년 봄',
  [arrin.id, kaien.id],
  {
    description: '마왕이 부활하여 새로운 모험 시작.',
    chapter: 1,
  }
);
console.log(`   - ${t2.id}: ${t2.name}`);

// 5. 스냅샷 생성
console.log('\n📸 스냅샷 생성 중...');

graph.setEntityStateInSnapshot(t2.id, arrin.id, {
  status: '화염 길드 소속 마법사',
  location: capital.id,
  notes: '마왕 토벌을 준비 중',
});

graph.setEntityStateInSnapshot(t2.id, kaien.id, {
  status: '성검의 소유자',
  location: capital.id,
  notes: '아린과 동행 준비 중',
});

console.log(`   - ${t2.id} 스냅샷 완료`);

// 6. 쿼리 테스트
console.log('\n🔍 쿼리 테스트:');

// 캐릭터 조회
const characters = graph.getEntitiesByCategory('character');
console.log(`\n   캐릭터 목록 (${characters.length}명):`);
for (const char of characters) {
  console.log(`   - ${char.name}: ${char.description}`);
}

// 아린의 관계
const arrinEdges = graph.getEdgesForEntity(arrin.id);
console.log(`\n   아린의 관계 (${arrinEdges.length}개):`);
for (const edge of arrinEdges) {
  console.log(`   - [${edge.type}] ${edge.statement}`);
}

// 아린-카이엔 관계
const arrinKaienEdges = graph.getEdgesBetween(arrin.id, kaien.id);
console.log(`\n   아린-카이엔 관계 (${arrinKaienEdges.length}개):`);
for (const edge of arrinKaienEdges) {
  console.log(`   - [${edge.type}] ${edge.statement}`);
}

// 캐릭터 연대기
const chronicle = graph.getCharacterChronicle(arrin.id);
console.log(`\n   아린의 연대기 (${chronicle.events.length}개 이벤트):`);
for (const event of chronicle.events) {
  console.log(`   - ${event.description}`);
}

// 7. JSON 내보내기
console.log('\n💾 JSON 내보내기:');
const ontology = graph.toJSON();
console.log(`   - 제목: ${ontology.metadata.title}`);
console.log(`   - 총 엔티티: ${ontology.stats.totalEntities}`);
console.log(`   - 총 관계: ${ontology.stats.totalEdges}`);
console.log(`   - 타임라인 포인트: ${ontology.timeline.length}`);

console.log('\n   엔티티 분포:');
for (const [category, count] of Object.entries(ontology.stats.entitiesByCategory)) {
  console.log(`   - ${category}: ${count}`);
}

console.log('\n   관계 분포:');
for (const [type, count] of Object.entries(ontology.stats.edgesByType)) {
  console.log(`   - ${type}: ${count}`);
}

// 8. JSON 복원 테스트
console.log('\n🔄 JSON 복원 테스트:');
const restored = HyperGraph.fromJSON(ontology);
console.log(`   - 복원된 엔티티: ${restored.getAllEntities().length}`);
console.log(`   - 복원된 관계: ${restored.getAllEdges().length}`);

console.log('\n' + '='.repeat(50));
console.log('✅ 모든 테스트 완료!');
console.log('='.repeat(50));
