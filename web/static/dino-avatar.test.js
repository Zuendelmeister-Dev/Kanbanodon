const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const avatars = require("./dino-avatar.js");

const first = avatars.createDinoAvatar("template-01-trex-stride", { template: "trex-stride", palette: "Original" });
const again = avatars.createDinoAvatar("template-01-trex-stride", { template: "trex-stride", palette: "Original" });

assert.equal(avatars.templates.length, 20, "exactly twenty generated dinosaur base templates should be wired");
assert.equal(new Set(avatars.templates.map((item) => item.id)).size, 20, "template ids should be unique");
assert.equal(first, again, "same seed and options should generate the same markup");
assert.match(first, /^<img[\s\S]*>$/, "avatar should be image markup backed by a rendered PNG template");
assert.ok(first.includes("01-trex-stride.png"), "selected template should point at its PNG asset");
for (const template of avatars.templates) {
	assert.ok(template.file.endsWith(".png") && template.name && template.species);
	const assetPath = path.join(__dirname, "dino-templates", template.file);
	assert.ok(fs.existsSync(assetPath), "missing asset " + template.file);
}
assert.equal(avatars.createDinoAvatarDataURI("template-01-trex-stride", { template: "trex-stride" }), "/static/dino-templates/01-trex-stride.png");
