const test = require('node:test');
const assert = require('node:assert/strict');
const creator = require('./dino-creator.js');

test('all species use bundled mascot art with deterministic framing', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  assert.deepEqual(creator.accents, ['#60a5fa', '#f4b83f', '#37c7ad']);
  assert.equal(creator.species.length, 20);
  assert.equal(new Set(creator.species.map(item => item.id)).size, 20);
  for (const species of creator.species) {
    const artwork = path.join(__dirname, 'dino-art', species.id + '.png');
    assert.ok(fs.existsSync(artwork), 'Missing artwork: ' + species.id);
    for (const seed of ['00000000', '1234abcd', 'ffffffff']) {
      const value = `dino-v2:${species.id}:${seed}`;
      const svg = creator.createSVG(value);
      assert.equal(svg, creator.createSVG(value));
      assert.match(svg, /^<svg /);
      assert.match(svg, /viewBox="0 0 512 512"/);
      assert.match(svg, /<image /);
      assert.equal(creator.assetPath(value), '/static/dino-art/' + species.id + '.png?v=blue-gold-teal-20261007');
      assert.ok(svg.includes('href="' + creator.assetPath(value) + '"'));
      assert.ok(creator.anatomy[species.id]);
      // Keep painted anatomical colors intact: no palette filter or mirroring.
      assert.doesNotMatch(svg, /onclick|<script|<foreignObject|style=|filter=|transform=|<polygon/);
    }
  }
  assert.equal(creator.anatomy.triceratops, 'three horns');
  assert.notEqual(creator.createSVG('dino-v2:trex:00000000'), creator.createSVG('dino-v2:trex:ffffffff'));
});

test('standalone exports embed PNGs without accepting arbitrary URLs or markup', () => {
  const value = 'dino-v2:triceratops:1234abcd';
  const data = 'data:image/png;base64,aGVsbG8=';
  assert.ok(creator.createSVG(value, { embeddedImage: data }).includes('href="' + data + '"'));
  for (const embeddedImage of ['javascript:alert(1)', 'https://example.test/image.png', 'data:image/svg+xml,<script>bad</script>']) {
    const svg = creator.createSVG(value, { embeddedImage });
    assert.ok(svg.includes('href="/static/dino-art/triceratops.png?v=blue-gold-teal-20261007"'));
    assert.ok(!svg.includes(embeddedImage));
  }
});
test('invalid or injected avatar parameters are rejected', () => {
  for (const value of ['', 'raptor', 'dino-v2:unknown:1234abcd', 'dino-v2:trex:ABCDEF12', 'dino-v2:trex:1234abcd<script>', 'https://example.test/avatar.svg']) {
    assert.equal(creator.parse(value), null);
    assert.equal(creator.createSVG(value), '');
  }
});

test('randomization can lock species and emits only valid persisted values', () => {
  const values = new Set();
  for (let i = 0; i < 100; i++) {
    const value = creator.randomAvatar('pterosaur');
    assert.equal(creator.parse(value).species, 'pterosaur');
    values.add(value);
    assert.ok(creator.parse(creator.randomAvatar()));
  }
  assert.ok(values.size > 90);
});
