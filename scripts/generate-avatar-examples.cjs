// Regenerate a shuffled set with fresh seeds: node scripts/generate-avatar-examples.cjs
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const creator = require('../web/static/dino-creator.js');

const output = path.join(__dirname, '../.cache/avatar-examples');
function render(value, size) {
  const source = creator.assetPath(value);
  const file = path.join(__dirname, '../web', source.replace(/^\//, ''));
  const embeddedImage = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  return creator.createSVG(value, { size, embeddedImage });
}
fs.mkdirSync(output, { recursive: true });
const kinds = [...creator.species];
for (let i = kinds.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
}
const samples = process.argv.includes('--preserve')
  ? JSON.parse(fs.readFileSync(path.join(output, 'avatars.json'), 'utf8'))
  : kinds.map((kind, i) => {
  const value = creator.randomAvatar(kind.id);
  const file = `avatar-${String(i + 1).padStart(2, '0')}.svg`;
  return { number: i + 1, name: kind.name, value, file };
});
// Seeds vary framing, so count unique artwork by species rather than seed.
const uniqueSamples = [...new Map(samples.map(sample => [creator.parse(sample.value).species, sample])).values()]
  .map((sample, i) => ({ ...sample, number: i + 1, file: `avatar-${String(i + 1).padStart(2, '0')}.svg` }));
for (const kind of creator.species) {
  if (!uniqueSamples.some(sample => creator.parse(sample.value).species === kind.id)) {
    const number = uniqueSamples.length + 1;
    uniqueSamples.push({ number, name: kind.name, value: creator.randomAvatar(kind.id), file: `avatar-${String(number).padStart(2, '0')}.svg` });
  }
}
samples.splice(0, samples.length, ...uniqueSamples);
for (const file of fs.readdirSync(output)) {
  if (/^avatar-\d{2}\.svg$/.test(file) && !samples.some(sample => sample.file === file)) fs.unlinkSync(path.join(output, file));
}
for (const sample of samples) fs.writeFileSync(path.join(output, sample.file), render(sample.value, 512));
fs.writeFileSync(path.join(output, 'avatars.json'), JSON.stringify(samples, null, 2) + '\n');
const tiles = samples.map((sample, i) => {
  const x = 36 + (i % 5) * 278;
  const y = 150 + Math.floor(i / 5) * 302;
  const svg = render(sample.value, 236).replace('<svg ', `<svg x="${x + 11}" y="${y + 10}" `);
  return `<g><rect x="${x}" y="${y}" width="258" height="284" rx="20" fill="#111c26" stroke="#263745"/>${svg}<text x="${x + 18}" y="${y + 270}" fill="#edf2f7" font-family="Segoe UI,Arial,sans-serif" font-size="16">${String(i + 1).padStart(2, '0')}  ${sample.name}</text></g>`;
}).join('');
const height = 200 + Math.ceil(samples.length / 5) * 302;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}"><rect width="1440" height="${height}" fill="#080d12"/><text x="36" y="61" fill="#f1f5f9" font-family="Segoe UI,Arial,sans-serif" font-size="34" font-weight="700">KANBANODON / AVATAR CREATOR</text><text x="36" y="99" fill="#93a6b5" font-family="Segoe UI,Arial,sans-serif" font-size="18">${samples.length} unique dinosaurs · graphite &amp; silver</text><rect x="1152" y="62" width="68" height="10" rx="3" fill="${creator.accents[0]}"/><rect x="1228" y="62" width="68" height="10" rx="3" fill="${creator.accents[1]}"/><rect x="1304" y="62" width="68" height="10" rx="3" fill="${creator.accents[2]}"/>${tiles}<text x="36" y="${height - 29}" fill="#657b8b" font-family="Segoe UI,Arial,sans-serif" font-size="14">Fixed color order: RED → YELLOW → TEAL. Each saved seed reproduces its avatar.</text></svg>`;
fs.writeFileSync(path.join(output, 'avatar-gallery.svg'), sheet);
console.log(`Saved ${samples.length} avatars and gallery to ${output}`);
