const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const engine = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .find(match => match[1].includes('function colony('))[1];

function loadWorld(duel) {
  return runInNewContext(engine + '\n;({ colony, activityReason, trailActivity, STEP })', {
    location: { search: '?duel=' + Number(duel) },
    URLSearchParams
  });
}

test('une piste faible conserve la décision précédente entre les deux seuils', () => {
  const { trailActivity } = loadWorld(false);
  assert.equal(trailActivity('Explore', .071, 0), 'Suit une piste');
  assert.equal(trailActivity('Suit une piste', .065, 0), 'Suit une piste');
  assert.equal(trailActivity('Explore', .065, 0), 'Explore');
  assert.equal(trailActivity('Suit une piste', .049, 0), 'Explore');
});

for (const duel of [false, true]) {
  test('récolte, explication et livraison en ' + (duel ? 'duel' : 'solo'), () => {
    const { colony, activityReason, STEP } = loadWorld(duel);
    let seed = 17;
    const random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
    const colonies = [colony(random, 0)];
    if (duel) colonies.push(colony(random, 1));
    for (let i = 0; i < 900; i++) {
      for (const c of colonies) {
        c.tick(STEP);
        for (const ant of c.ants) {
          assert.ok(activityReason[ant.activity], ant.activity);
          if (ant.activity === 'Rapporte une graine') assert.ok(ant.load);
        }
      }
    }
    for (const c of colonies) assert.ok(c.ants.some(ant => ant.deliveries > 0));
  });
}
