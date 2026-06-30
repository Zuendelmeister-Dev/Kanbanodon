// Boots the standalone dinosaur avatar lab page.
(function(){
 var dino=window.KanbanodonDinoAvatars;
 // Finds an element by id inside the avatar lab.
 var $=function(id){return document.getElementById(id);};
 var preview=$('preview'),previewTitle=$('previewTitle'),previewMeta=$('previewMeta'),seedInput=$('seedInput'),templateSelect=$('templateSelect'),paletteSelect=$('paletteSelect'),grid=$('exampleGrid');
 // Creates a select option element.
 function option(value,label){var el=document.createElement('option');el.value=value;el.textContent=label||value;return el;}
 dino.templates.forEach(function(t,index){templateSelect.appendChild(option(t.id,String(index+1).padStart(2,'0')+' · '+t.name));});
 dino.palettes.forEach(function(p){paletteSelect.appendChild(option(p.name));});
 // Reads the current avatar lab options.
 function currentOptions(){return{template:templateSelect.value,palette:paletteSelect.value,size:300};}
 // Returns the currently selected avatar template.
 function currentTemplate(){return dino.templates.find(function(t){return t.id===templateSelect.value;})||dino.templates[0];}
 // Renders the avatar lab preview.
 function renderPreview(){var opts=currentOptions(),t=currentTemplate();preview.innerHTML=dino.createDinoAvatar(seedInput.value,opts);previewTitle.textContent=t.name+' · '+opts.palette;previewMeta.textContent=t.species+' · Seed: '+seedInput.value;}
 // Renders the avatar lab example grid.
 function renderExamples(){var examples=dino.createDinoAvatarExamples(20);grid.innerHTML='';examples.forEach(function(item){var card=document.createElement('article');card.className='example-card';var avatar=document.createElement('div');avatar.className='example-avatar';avatar.innerHTML=item.svg;var name=document.createElement('strong');name.textContent=item.name;var seed=document.createElement('span');seed.textContent=item.species+' · '+item.palette;card.appendChild(avatar);card.appendChild(name);card.appendChild(seed);grid.appendChild(card);});}
 // Chooses a random avatar lab template, palette, and seed.
 function randomize(){var t=dino.templates[Math.floor(Math.random()*dino.templates.length)],p=dino.palettes[Math.floor(Math.random()*dino.palettes.length)];templateSelect.value=t.id;paletteSelect.value=p.name;seedInput.value=t.id+'-'+Math.floor(Math.random()*99999).toString().padStart(5,'0');renderPreview();}
 // Downloads the currently selected avatar template image.
 async function download(){var t=currentTemplate();var response=await fetch('/static/dino-templates/'+t.file);var blob=await response.blob();var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=seedInput.value.replace(/[^a-z0-9-]+/gi,'-').toLowerCase()+'.png';a.click();URL.revokeObjectURL(url);}
 ['input','change'].forEach(function(eventName){seedInput.addEventListener(eventName,renderPreview);templateSelect.addEventListener(eventName,renderPreview);paletteSelect.addEventListener(eventName,renderPreview);});
 $('randomBtn').addEventListener('click',randomize);
 $('downloadBtn').addEventListener('click',download);
 templateSelect.value='trex-stride';paletteSelect.value='Original';renderPreview();renderExamples();
})();
