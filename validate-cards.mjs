// =====================================================================
// TOP DECK! — Vérificateur du catalogue de cartes
// =====================================================================
//   npm run cards
//
// Analyse le champ `effect` de chaque carte de js/cards.js et signale
// toute faute de syntaxe (effet inconnu, arité fausse, « : » oublié…).
// À lancer après chaque modification du catalogue : une erreur trouvée
// ici est une erreur qui n'arrivera pas en pleine partie.
// =====================================================================
import { CARD_CATALOG } from "./js/cards.js";
import { validateCardEffects, parseEffect, EFFECT_TRIGGERS } from "./js/engine/effect-parser.js";

const cards = Object.values(CARD_CATALOG);
const errors = [];
let withEffect = 0;

console.log(`Vérification de ${cards.length} cartes…\n`);

for (const card of cards) {
  const errs = validateCardEffects(card);
  errors.push(...errs);

  if (!card.effect) continue;
  withEffect++;
  const lines = [];
  for (const trigger of EFFECT_TRIGGERS) {
    const src = card.effect[trigger];
    if (!src) continue;
    let count = "?";
    try { count = parseEffect(src).length; } catch { /* déjà signalé */ }
    lines.push(`      ${trigger.padEnd(9)} ${src}`);
  }
  console.log(`  ${card.name} (${card.attack}/${card.defense}, ${card.rarity})`);
  lines.forEach((l) => console.log(l));
}

console.log(`\n${withEffect} carte(s) avec effet sur ${cards.length}.`);

if (errors.length) {
  console.log(`\n❌ ${errors.length} erreur(s) :`);
  errors.forEach((e) => console.log("   " + e));
  process.exit(1);
}
console.log("✔ Tous les effets sont syntaxiquement valides.");
