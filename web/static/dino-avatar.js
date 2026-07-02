// Exposes dinosaur avatar helpers in browsers and CommonJS test environments.
(function(root,factory){
 if(typeof module==='object'&&module.exports){module.exports=factory();}else{root.KanbanodonDinoAvatars=factory();}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 var basePath='/static/dino-templates/';
 var palettes=[
  {name:'Original',filter:'none'},
  {name:'Kanbanodon',filter:'contrast(1.04) saturate(1.04)'},
  {name:'Amber',filter:'sepia(.24) saturate(1.16) hue-rotate(-8deg)'},
  {name:'Jade',filter:'sepia(.12) saturate(1.18) hue-rotate(112deg)'},
  {name:'Signal',filter:'sepia(.14) saturate(1.22) hue-rotate(-34deg)'},
  {name:'Slate',filter:'saturate(.96) hue-rotate(188deg) contrast(1.04)'},
  {name:'Plum',filter:'sepia(.1) saturate(1.12) hue-rotate(238deg)'},
  {name:'Moss',filter:'sepia(.2) saturate(1.12) hue-rotate(72deg)'}
 ];
 var templates=[
  {id:'trex-stride',name:'T-Rex Stride',species:'t-rex',file:'01-trex-stride.png',palette:'Kanbanodon'},
  {id:'trex-roar',name:'T-Rex Roar',species:'t-rex',file:'02-trex-roar.png',palette:'Carbon'},
  {id:'raptor',name:'Raptor',species:'raptor',file:'03-raptor.png',palette:'Jade'},
  {id:'allosaurus',name:'Allosaurus',species:'allosaurus',file:'04-allosaurus.png',palette:'Moss'},
  {id:'triceratops',name:'Triceratops',species:'triceratops',file:'05-triceratops.png',palette:'Lagoon'},
  {id:'triceratops-heavy',name:'Triceratops Heavy',species:'triceratops',file:'06-triceratops-heavy.png',palette:'Amber'},
  {id:'styracosaurus',name:'Styracosaurus',species:'styracosaurus',file:'07-styracosaurus.png',palette:'Signal'},
  {id:'stegosaurus',name:'Stegosaurus',species:'stegosaurus',file:'08-stegosaurus.png',palette:'Jade'},
  {id:'kentrosaurus',name:'Kentrosaurus',species:'kentrosaurus',file:'09-kentrosaurus.png',palette:'Moss'},
  {id:'ankylosaurus',name:'Ankylosaurus',species:'ankylosaurus',file:'10-ankylosaurus.png',palette:'Amber'},
  {id:'brontosaurus',name:'Brontosaurus',species:'brontosaurus',file:'11-brontosaurus.png',palette:'Lagoon'},
  {id:'brachiosaurus',name:'Brachiosaurus',species:'brachiosaurus',file:'12-brachiosaurus.png',palette:'Signal'},
  {id:'spinosaurus',name:'Spinosaurus',species:'spinosaurus',file:'13-spinosaurus.png',palette:'Slate'},
  {id:'parasaurolophus',name:'Parasaurolophus',species:'parasaurolophus',file:'14-parasaurolophus.png',palette:'Plum'},
  {id:'iguanodon',name:'Iguanodon',species:'iguanodon',file:'15-iguanodon.png',palette:'Amber'},
  {id:'pachycephalosaurus',name:'Pachycephalosaurus',species:'pachycephalosaurus',file:'16-pachycephalosaurus.png',palette:'Moss'},
  {id:'gallimimus',name:'Gallimimus',species:'gallimimus',file:'17-gallimimus.png',palette:'Lagoon'},
  {id:'pterosaur-wide',name:'Pterosaur Wide',species:'pterosaur',file:'18-pterosaur-wide.png',palette:'Signal'},
  {id:'pterosaur-dive',name:'Pterosaur Dive',species:'pterosaur',file:'19-pterosaur-dive.png',palette:'Amber'},
  {id:'dimetrodon',name:'Dimetrodon',species:'dimetrodon',file:'20-dimetrodon.png',palette:'Jade'}
 ];
 // Creates a stable numeric hash for avatar selection.
 function hashSeed(seed){var h=2166136261,s=String(seed||'kanbanodon');for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
 // Selects a dinosaur template from a seed.
 function pickTemplate(seed){return templates[hashSeed(seed)%templates.length];}
 // Finds a dinosaur template by id or falls back to a seeded pick.
 function findTemplate(id){return templates.find(function(t){return t.id===id;})||pickTemplate(id||'kanbanodon');}
 // Finds a color palette by name or returns the default palette.
 function findPalette(name){return palettes.find(function(p){return p.name===name;})||palettes[0];}
 // Escapes text for safe HTML attribute usage.
 function escapeAttr(value){return String(value).replace(/[&<>"']/g,function(char){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
 // Builds the static asset path for a dinosaur template.
 function assetPath(template){return basePath+template.file;}
 // Builds HTML for a generated dinosaur avatar image.
 function createDinoAvatar(seed,options){
  var opts=options||{},template=findTemplate(opts.template||opts.species||seed),palette=findPalette(opts.palette||'Original'),size=opts.size||180;
  return '<img class="generated-dino-template" src="'+assetPath(template)+'" width="'+size+'" height="'+size+'" alt="'+escapeAttr(template.name)+' avatar" style="filter:'+escapeAttr(palette.filter)+'">';
 }
 // Returns the image asset path for a generated avatar.
 function createDinoAvatarDataURI(seed,options){
  var opts=options||{},template=findTemplate(opts.template||opts.species||seed);
  return assetPath(template);
 }
 return{palettes:palettes,templates:templates,species:templates.map(function(t){return t.species;}),createDinoAvatar:createDinoAvatar,createDinoAvatarDataURI:createDinoAvatarDataURI};
});
