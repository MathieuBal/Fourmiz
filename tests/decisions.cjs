const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const engine = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .find(match => match[1].includes('function colony('))[1];

function loadWorld(duel) {
  return runInNewContext(engine + '\n;({ colony, activityReason, trailActivity, assessEncounter, ground, W, STEP })', {
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

test('une visite cible une larve, accélère sa maturation et conserve la ration', () => {
  function fixture() {
    const { colony, STEP } = loadWorld(false);
    const c = colony(() => .5, 0);
    const larva = { id: 100, age: 9, hunger: 0, caredUntil: 0, nurse: null };
    c.brood.push(larva);
    return { c, larva, STEP };
  }
  const visit = fixture();
  const control = fixture();
  for (const ant of control.c.ants) ant.nextCare = Infinity;
  visit.c.tick(visit.STEP);
  control.c.tick(control.STEP);
  const nurse = visit.larva.nurse;
  assert.ok(nurse && nurse.patient === visit.larva && nurse.inside);
  assert.equal(visit.c.ants.filter(ant => ant.patient).length, 1);
  for (let i = 1; i < 122; i++) {
    visit.c.tick(visit.STEP);
    control.c.tick(control.STEP);
  }
  assert.ok(visit.larva.age > control.larva.age);
  assert.equal(visit.c.consumed, control.c.consumed);
  assert.equal(visit.larva.nurse, null);
  assert.equal(nurse.patient, null);
  assert.ok(!nurse.inside);
});

test('une nourrice interrompue libère la larve sans valider sa visite', () => {
  const { colony, STEP } = loadWorld(false);
  const c = colony(() => .5, 0);
  const larva = { id: 100, age: 9, hunger: 0, caredUntil: 0, nurse: null };
  c.brood.push(larva);
  c.tick(STEP);
  const first = larva.nurse;
  assert.ok(first);
  first.expires = c.time;
  c.tick(STEP);
  assert.equal(first.cause, 'âge');
  assert.notEqual(larva.nurse, first);
  assert.equal(larva.caredUntil, 0);
});

test('une porteuse isolée se retire, le soutien local change sa décision', () => {
  const { assessEncounter } = loadWorld(true);
  const worker = { x: 100, y: 90, team: 0, load: true };
  const home = { x: 50, y: 90 };
  const pair = [worker, { team: 1 }];
  assert.ok(assessEncounter(worker, pair, home).withdraw);
  assert.equal(assessEncounter(worker, [...pair, { team: 0 }], home).withdraw, false);
  assert.equal(assessEncounter(worker, pair, worker).withdraw, false);
});

test('une confrontation recrute une voisine, puis son alarme expire', () => {
  const { colony, ground, W, STEP } = loadWorld(true);
  const ochre = colony(() => .4, 0);
  const blue = colony(() => .4, 1);
  const [caller, helper, distant] = ochre.ants;
  const [opponent] = blue.ants;
  function place(ant, x, y) {
    for (const bucket of ground.buckets) bucket.delete(ant);
    ant.x = x;
    ant.y = y;
    ground.buckets[Math.floor(y / 4) * Math.ceil(W / 4) + Math.floor(x / 4)].add(ant);
  }
  place(caller, 267, 90);
  place(opponent, 269, 90);
  place(helper, 264, 90);
  place(distant, 190, 70);
  // Isolate the fixture from the other founding workers at the blue nest.
  for (const ant of blue.ants.slice(1)) {
    for (const bucket of ground.buckets) bucket.delete(ant);
  }
  ochre.tick(STEP);
  assert.equal(caller.opponent, opponent);
  assert.equal(helper.activity, 'Répond à une alarme');
  assert.notEqual(distant.activity, helper.activity);
  place(opponent, 230, 140);
  for (let i = 0; i < 110; i++) ochre.tick(STEP);
  assert.ok(ochre.time > caller.alarmUntil);
  assert.notEqual(helper.activity, 'Répond à une alarme');
});
