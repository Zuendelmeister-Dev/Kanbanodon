const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const avatars = require("./dino-avatar.js");

const first = avatars.createDinoAvatar("template-01-trex-stride", { template: "trex-stride", palette: "Original" });
const again = avatars.createDinoAvatar("template-01-trex-stride", { template: "trex-stride", palette: "Original" });
const examples = avatars.createDinoAvatarExamples(20);

assert.equal(avatars.templates.length, 20, "exactly twenty generated dinosaur base templates should be wired");
assert.equal(first, again, "same seed and options should generate the same markup");
assert.equal(examples.length, 20, "example generator should create twenty visible base templates");
assert.equal(new Set(examples.map((item) => item.template)).size, 20, "examples should show twenty distinct templates");
assert.match(first, /^<img[\s\S]*>$/, "avatar should be image markup backed by a rendered PNG template");
assert.ok(first.includes("01-trex-stride.png"), "selected template should point at its PNG asset");
assert.ok(examples.every((item) => item.src.endsWith(".png") && item.name && item.species && item.palette));
for (const item of examples) {
	const assetPath = path.join(__dirname, item.src.replace("/static/", ""));
	assert.ok(fs.existsSync(assetPath), "missing asset " + item.src);
}
assert.equal(avatars.createDinoAvatarDataURI("template-01-trex-stride", { template: "trex-stride" }), "/static/dino-templates/01-trex-stride.png");
