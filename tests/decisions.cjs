const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const engine = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .find(match => match[1].includes('function colony('))[1];

function loadWorld(duel) {
  return runInNewContext(engine + '\n;({ colony, activityReason, trailActivity, assessEncounter, recordEncounter, ground, W, STEP })', {
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

test('deux passages : détour après des rencontres répétées et retour après dissipation', () => {
  function trip(events, elapsed = 0, alternative = true) {
    const { colony, recordEncounter, ground, W, STEP } = loadWorld(true);
    const c = colony(() => .5, 0);
    const ant = c.ants[0];
    c.ants.splice(1);
    for (const bucket of ground.buckets) bucket.clear();
    for (let y = 1; y < 180; y += 2) {
      if ((y >= 87 && y <= 93) || (alternative && y >= 95 && y <= 101)) continue;
      c.paint(72, y, true);
    }
    c.paint(72, 94, true);
    for (let i = 0; i < events; i++) recordEncounter(73, 90, i - events + 1);
    for (let i = 0; i < elapsed / STEP; i++) c.tick(STEP);
    for (const bucket of ground.buckets) bucket.clear();
    Object.assign(ant, { x: 82, y: 90, a: Math.PI, load: true, homeward: [], tripMarks: new Map(), tripDistance: 0 });
    ground.buckets[Math.floor(ant.y / 4) * Math.ceil(W / 4) + Math.floor(ant.x / 4)].add(ant);
    let crossing, detoured = false;
    const deliveries = ant.deliveries;
    for (let i = 0; i < 600 && ant.deliveries === deliveries; i++) {
      c.tick(STEP);
      if (ant.activity === 'Contourne une zone disputée') detoured = true;
      if (crossing === undefined && ant.x < 72) crossing = ant.y;
    }
    assert.equal(ant.deliveries, deliveries + 1);
    return { crossing, detoured };
  }
  const quiet = trip(0), single = trip(1), disputed = trip(2), reopened = trip(2, 37);
  const onlyOpening = trip(2, 0, false);
  assert.ok(onlyOpening.crossing < 94);
  assert.ok(quiet.crossing < 94 && single.crossing < 94);
  assert.ok(disputed.detoured && disputed.crossing > 96, JSON.stringify(disputed));
  assert.ok(!reopened.detoured && reopened.crossing < 94);
});

test('une ouvrière garde son entrée après deux contacts puis reprend les livraisons', () => {
  const { colony, ground, W, STEP } = loadWorld(true);
  const home = colony(() => .4, 0);
  const away = colony(() => .4, 1);
  const [worker] = home.ants, [intruder] = away.ants;
  home.ants.splice(5);
  away.ants.splice(1);
  for (const bucket of ground.buckets) bucket.clear();
  function place(ant, x, y) {
    for (const bucket of ground.buckets) bucket.delete(ant);
    Object.assign(ant, { x, y });
    ground.buckets[Math.floor(y / 4) * Math.ceil(W / 4) + Math.floor(x / 4)].add(ant);
  }
  function meet() {
    place(worker, 57, 90);
    place(intruder, 59, 90);
    home.tick(STEP);
  }
  for (let i = 1; i < 5; i++) place(home.ants[i], 100+i*3, 110);
  meet();
  assert.equal(worker.guardUntil, undefined);
  place(intruder, 100, 90);
  for (let i = 0; i < 170; i++) home.tick(STEP);
  meet();
  assert.ok(worker.guardUntil > home.time);
  assert.equal(intruder.guardUntil, undefined);
  place(intruder, 100, 90);
  let patrol = false, reversed = false;
  const side = worker.guardSide;
  for (let i = 0; i < 180; i++) {
    home.tick(STEP);
    patrol ||= worker.activity === 'Patrouille à l’entrée';
    reversed ||= side !== worker.guardSide;
  }
  assert.ok(patrol && reversed);
  place(worker, 57, 90);
  place(intruder, 60, 90);
  home.tick(STEP);
  assert.equal(worker.activity, 'Surveille une intruse');
  place(intruder, 66, 90);
  home.tick(STEP);
  assert.equal(worker.activity, 'Patrouille à l’entrée');
  while (home.time <= worker.guardUntil + STEP) home.tick(STEP);
  const previous = worker.deliveries;
  home.seeds(worker.x, worker.y, 3);
  for (let i = 0; i < 450 && worker.deliveries === previous; i++) home.tick(STEP);
  assert.ok(worker.deliveries > previous);
});

test('des contacts répétés sur huit fronts laissent la voie libre à une porteuse', () => {
  const { colony, ground, W, STEP } = loadWorld(true);
  const home = colony(() => .4, 0), away = colony(() => .4, 1);
  home.ants.splice(16);
  away.ants.splice(8);
  const carrier = home.ants[8];
  for (const bucket of ground.buckets) bucket.clear();
  function place(ant, x, y) {
    for (const bucket of ground.buckets) bucket.delete(ant);
    Object.assign(ant, { x, y });
    ground.buckets[Math.floor(y / 4) * Math.ceil(W / 4) + Math.floor(x / 4)].add(ant);
  }
  function invade() {
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      place(home.ants[i], 50 + 10 * Math.cos(angle), 90 + 10 * Math.sin(angle));
      place(away.ants[i], 50 + 12 * Math.cos(angle), 90 + 12 * Math.sin(angle));
    }
    home.tick(STEP);
  }
  for (let i = 8; i < 16; i++) place(home.ants[i], 90+i*3, 105);
  invade();
  for (const [i, ant] of away.ants.entries()) place(ant, 200+i*3, 90);
  for (let i = 0; i < 155; i++) home.tick(STEP);
  invade();
  const guards = home.ants.filter(a => a.guardUntil > home.time);
  assert.equal(guards.length, 2);
  assert.ok(Math.cos(guards[0].guardBearing - guards[1].guardBearing) <= .001);
  for (const [i, ant] of away.ants.entries()) place(ant, 200+i*3, 90);
  place(carrier, 65, 90);
  Object.assign(carrier, { a: Math.PI, load: true, homeward: [], tripMarks: new Map(), tripDistance: 0 });
  const before = carrier.deliveries;
  for (let i = 0; i < 420 && carrier.deliveries === before; i++) home.tick(STEP);
  assert.equal(carrier.deliveries, before + 1);
  assert.ok(guards.every(a => a.guardUntil > home.time));
  for (const population of [9, 4]) {
    const others = home.ants.filter(a => !guards.includes(a));
    for (const ant of others.slice(0, home.ants.length-population)) ant.expires = home.time;
    home.tick(STEP);
    assert.equal(home.ants.length, population);
    assert.equal(home.ants.filter(a => a.guardUntil > home.time).length, Math.floor(population/5));
  }
});

test('offensive locale : une rivale recule et une récolteuse livre une graine du tas disputé', () => {
  const { colony, ground, W, STEP } = loadWorld(true);
  const blue = colony(() => .4, 1), ochre = colony(() => .4, 0);
  blue.ants.splice(7);
  ochre.ants.splice(1);
  for (const bucket of ground.buckets) bucket.clear();
  function place(ant, x, y) {
    for (const bucket of ground.buckets) bucket.delete(ant);
    Object.assign(ant, { x, y, a: 0 });
    ground.buckets[Math.floor(y/4)*Math.ceil(W/4)+Math.floor(x/4)].add(ant);
  }
  // The defender is three units from the first attacker, outside grapple range.
  blue.seeds(250, 90, 30);
  const pile = blue.food.find(f => f.x === 250);
  place(ochre.ants[0], 250, 91);
  const [leader, support, carrier] = blue.ants;
  place(leader, 247, 91);
  place(support, 246, 93);
  for (const [i,a] of blue.ants.slice(2).entries()) place(a, 280+i*3, 110);
  blue.tick(STEP);
  assert.equal(blue.offensive.pile, pile);
  assert.equal(leader.activity, 'Avance vers une rivale');
  assert.ok(ochre.ants[0].avoidUntil > blue.time);
  const report = blue.lastOffensive;
  place(ochre.ants[0], 220, 130);
  place(carrier, 250, 90);
  blue.tick(STEP);
  assert.ok(carrier.load);
  assert.deepEqual(Array.from(report.after), [0,0]);
  for (let i=0; i<900 && !report.after[1]; i++) blue.tick(STEP);
  assert.ok(report.after[1] > 0);
  for (let i=0;i<100;i++) blue.tick(STEP);
  assert.equal(blue.offensive, null);
});
