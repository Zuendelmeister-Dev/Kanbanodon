// Seed-stable avatar composition using locally bundled mascot-style illustrations.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KanbanodonDinoCreator = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const species = [
    { id: 'pterosaur', name: 'Pterosaur' },
    { id: 'trex', name: 'T-Rex' },
    { id: 'raptor', name: 'Raptor' },
    { id: 'triceratops', name: 'Triceratops' },
    { id: 'stegosaurus', name: 'Stegosaurus' },
    { id: 'brachiosaurus', name: 'Brachiosaurus' },
    { id: 'ankylosaurus', name: 'Ankylosaurus' },
    { id: 'spinosaurus', name: 'Spinosaurus' },
    { id: 'parasaurolophus', name: 'Parasaurolophus' },
    { id: 'pachycephalosaurus', name: 'Pachycephalosaurus' },
    { id: 'carnotaurus', name: 'Carnotaurus' },
    { id: 'dilophosaurus', name: 'Dilophosaurus' },
    { id: 'allosaurus', name: 'Allosaurus' },
    { id: 'iguanodon', name: 'Iguanodon' },
    { id: 'therizinosaurus', name: 'Therizinosaurus' },
    { id: 'oviraptor', name: 'Oviraptor' },
    { id: 'gallimimus', name: 'Gallimimus' },
    { id: 'protoceratops', name: 'Protoceratops' },
    { id: 'styracosaurus', name: 'Styracosaurus' },
    { id: 'kentrosaurus', name: 'Kentrosaurus' },
  ];
  // Always screen-left to screen-right, including flight and standing poses.
  const accents = Object.freeze(['#60a5fa', '#f4b83f', '#37c7ad']);
  const artworkVersion = 'blue-gold-teal-20261007';
  const prefix = 'dino-v2';

  function parse(value) {
    const match = /^dino-v2:([a-z]+):([0-9a-f]{8})$/.exec(String(value || ''));
    if (!match || !species.some(item => item.id === match[1])) return null;
    return { species: match[1], seed: match[2] };
  }

  function randomAvatar(selectedSpecies) {
    const bytes = new Uint32Array(2);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 0x100000000);
    const kind = species.some(item => item.id === selectedSpecies)
      ? selectedSpecies : species[bytes[0] % species.length].id;
    return prefix + ':' + kind + ':' + bytes[1].toString(16).padStart(8, '0');
  }

  function rng(seed) {
    let n = parseInt(seed, 16) >>> 0;
    return function () {
      n = (n + 0x6d2b79f5) >>> 0;
      let t = Math.imul(n ^ (n >>> 15), 1 | n);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    };
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const anatomy = Object.freeze({
    pterosaur: 'wing membranes',
    trex: 'dorsal scutes',
    raptor: 'crest feathers',
    triceratops: 'three horns',
    stegosaurus: 'dorsal plates',
    brachiosaurus: 'neck markings',
    ankylosaurus: 'armored osteoderms',
    spinosaurus: 'sail membranes',
    parasaurolophus: 'three contiguous blue then gold then teal sections along the crest from screen left to right',
    pachycephalosaurus: 'three anatomical bands blue gold teal across dome from screen left to right',
    carnotaurus: 'three dorsal scute groups blue gold teal along spine from screen left to right, horns silver',
    dilophosaurus: 'anatomical crest lobes colored blue gold teal in screen left to right sequence',
    allosaurus: 'three brow ridge/scute sections blue gold teal across visible head from screen left to right',
    iguanodon: 'three anatomical neck markings curving naturally blue gold teal from screen left to right',
    therizinosaurus: 'three claws of prominently visible hand colored blue gold teal from screen left to right',
    oviraptor: 'three crest sections blue gold teal from screen left to right',
    gallimimus: 'three tail feather fans blue gold teal from screen left to right',
    protoceratops: 'three natural frill lobes blue gold teal from screen left to right',
    styracosaurus: 'three prominent frill spikes colored blue gold teal from screen left to right',
    kentrosaurus: 'three prominent tail spike groups blue gold teal from screen left to right',
  });

  function assetPath(value) {
    const parsed = parse(value);
    return parsed ? '/static/dino-art/' + parsed.species + '.png?v=' + artworkVersion : '';
  }

  function createSVG(value, options = {}) {
    const parsed = parse(value);
    if (!parsed) return '';
    const item = species.find(candidate => candidate.id === parsed.species);
    const random = rng(parsed.seed);
    const frame = ['#27343e', '#33414b', '#3a454c'][Math.floor(random() * 3)];
    const inset = 10 + Math.floor(random() * 22);
    const y = 10 + Math.floor(random() * 16);
    const width = 512 - inset * 2;
    const size = Number.isFinite(+options.size) ? Math.max(16, Math.min(2048, +options.size)) : 180;
    // Exports can embed the exact static PNG. Never accept arbitrary image URLs.
    const embedded = options.embeddedImage;
    const source = typeof embedded === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(embedded)
      ? embedded : assetPath(value);
    return '<svg xmlns="http://www.w3.org/2000/svg" class="generated-dino-avatar" viewBox="0 0 512 512" width="' + size + '" height="' + size + '" role="img" aria-label="' + esc(item.name + ' avatar') + '">'
      + '<rect width="512" height="512" rx="56" fill="#080d12"/>'
      + '<rect x="6" y="6" width="500" height="500" rx="50" fill="none" stroke="' + frame + '" stroke-width="3"/>'
      + '<image x="' + inset + '" y="' + y + '" width="' + width + '" height="' + width + '" href="' + source + '" preserveAspectRatio="xMidYMid meet"/>'
      + '</svg>';
  }
  return { species, accents, anatomy, assetPath, parse, randomAvatar, createSVG };
});
