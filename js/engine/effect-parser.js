// =====================================================================
// TOP DECK! — Mini-langage des effets de cartes (PARSEUR, fonctions pures)
// =====================================================================
// Un effet s'écrit en texte dans js/cards.js, champ `effect` :
//
//   {
//     on_play: 'look_top; if card.name == "Caillou" : gain(1/1)',
//     on_death: 'go_bottom',
//     on_seen: 'gain(0/1)'
//   }
//
// GRAMMAIRE
// ---------
//   programme  := instruction (";" | retour-ligne) instruction ...
//   instruction := appel | condition
//   condition  := "if" expression ":" bloc [ "else" ":" bloc ]
//   bloc       := instruction | "{" programme "}"
//   appel      := NOM [ "(" args ")" ]
//   args       := nombre | nombre "/" nombre
//   expression := comparaison [ ("and" | "or") comparaison ... ]
//   comparaison := operande ("=="|"!="|">"|"<"|">="|"<=") operande
//                | operande            (vrai si non nul / non vide)
//   operande   := nombre | "texte" | chemin (ex: card.name, self.attack)
//
// Le `if` peut suivre un appel sur la même ligne, comme demandé :
//   look_top if card.name == "Caillou" : gain(1/1)
// (équivaut à : look_top ; if card.name == "Caillou" : gain(1/1))
//
// EFFETS RECONNUS (voir effects.js pour leur exécution)
//   scry(x) mill_own(x) mill_opp(x) organize_own(x) organize_opp(x)
//   search(x) go_bottom gain(x/y) look_top look_bot
//
// VARIABLES UTILISABLES DANS LES CONDITIONS
//   card.*  : la DERNIÈRE carte regardée (look_top, look_bot, scry…)
//   self.*  : la carte qui porte l'effet
//   opp.*   : la carte que l'adversaire a jouée ce tour
//   attributs : id, name, rarity, attack, defense, effect
//   (+ raccourcis : my.deck_size, opp.deck_size, my.discard_size…)
// =====================================================================

export const EFFECT_TRIGGERS = ["on_play", "on_death", "on_seen"];

/** Effets connus et arité attendue. */
export const EFFECT_SPECS = {
  scry: { args: "count", interactive: true },
  mill_own: { args: "count", interactive: false },
  mill_opp: { args: "count", interactive: false },
  organize_own: { args: "count", interactive: true },
  organize_opp: { args: "count", interactive: true },
  search: { args: "count", interactive: true },
  go_bottom: { args: "none", interactive: false },
  gain: { args: "pair", interactive: false },
  look_top: { args: "none", interactive: false },
  look_bot: { args: "none", interactive: false }
};

const COMPARATORS = ["==", "!=", ">=", "<=", ">", "<"];

export class EffectParseError extends Error {}

// ---------------------------------------------------------------
// 1. Découpage en jetons
// ---------------------------------------------------------------
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const isNameChar = (c) => /[A-Za-z0-9_.]/.test(c);

  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; } // commentaire

    // Chaîne "…" ou '…'
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1, out = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < src.length) { out += src[j + 1]; j += 2; continue; }
        out += src[j++];
      }
      if (j >= src.length) throw new EffectParseError(`Chaîne non terminée : ${src.slice(i, i + 20)}`);
      tokens.push({ type: "string", value: out });
      i = j + 1;
      continue;
    }

    // Comparateur (les 2 caractères d'abord : >= avant >)
    const two = src.slice(i, i + 2);
    if (COMPARATORS.includes(two)) { tokens.push({ type: "op", value: two }); i += 2; continue; }
    if (COMPARATORS.includes(c)) { tokens.push({ type: "op", value: c }); i += 1; continue; }

    if ("():;{}/,".includes(c)) { tokens.push({ type: "punct", value: c }); i++; continue; }

    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i + (c === "-" ? 1 : 0);
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      tokens.push({ type: "number", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }

    if (isNameChar(c)) {
      let j = i;
      while (j < src.length && isNameChar(src[j])) j++;
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      if (["if", "else", "and", "or", "not"].includes(lower)) tokens.push({ type: "keyword", value: lower });
      else tokens.push({ type: "name", value: word });
      i = j;
      continue;
    }

    throw new EffectParseError(`Caractère inattendu « ${c} » dans : ${src}`);
  }
  return tokens;
}

// ---------------------------------------------------------------
// 2. Analyse syntaxique -> AST
// ---------------------------------------------------------------
class Parser {
  constructor(tokens, src) { this.t = tokens; this.i = 0; this.src = src; }
  peek(k = 0) { return this.t[this.i + k] || null; }
  next() { return this.t[this.i++] || null; }
  is(type, value) {
    const tk = this.peek();
    return !!tk && tk.type === type && (value === undefined || tk.value === value);
  }
  eat(type, value) {
    if (!this.is(type, value)) {
      const tk = this.peek();
      throw new EffectParseError(
        `Attendu ${value ?? type}, trouvé ${tk ? `« ${tk.value} »` : "la fin"} dans : ${this.src}`
      );
    }
    return this.next();
  }
  skipSeparators() { while (this.is("punct", ";")) this.next(); }

  parseProgram(stopOnBrace = false) {
    const body = [];
    this.skipSeparators();
    while (this.peek() && !(stopOnBrace && this.is("punct", "}"))) {
      body.push(this.parseStatement());
      this.skipSeparators();
    }
    return body;
  }

  parseStatement() {
    if (this.is("keyword", "if")) return this.parseIf();
    const call = this.parseCall();
    // `look_top if … : …` : le if qui SUIT un appel sur la même ligne
    // est une instruction à part entière (sucre syntaxique demandé).
    if (this.is("keyword", "if")) return { type: "seq", body: [call, this.parseIf()] };
    return call;
  }

  parseIf() {
    this.eat("keyword", "if");
    const test = this.parseExpression();
    this.eat("punct", ":");
    const then = this.parseBlock();
    let alt = null;
    this.skipSeparators();
    if (this.is("keyword", "else")) {
      this.next();
      this.eat("punct", ":");
      alt = this.parseBlock();
    }
    return { type: "if", test, then, else: alt };
  }

  parseBlock() {
    if (this.is("punct", "{")) {
      this.next();
      const body = this.parseProgram(true);
      this.eat("punct", "}");
      return body;
    }
    return [this.parseStatement()];
  }

  parseCall() {
    const nameTk = this.eat("name");
    const name = String(nameTk.value).toLowerCase();
    const spec = EFFECT_SPECS[name];
    if (!spec) {
      throw new EffectParseError(
        `Effet inconnu « ${nameTk.value} ». Effets valides : ${Object.keys(EFFECT_SPECS).join(", ")}`
      );
    }
    let args = [];
    if (this.is("punct", "(")) {
      this.next();
      if (!this.is("punct", ")")) {
        args.push(this.eat("number").value);
        while (this.is("punct", "/") || this.is("punct", ",")) {
          this.next();
          args.push(this.eat("number").value);
        }
      }
      this.eat("punct", ")");
    }
    // Validation d'arité : une erreur de carte doit être détectée au
    // chargement du catalogue, pas en plein match.
    if (spec.args === "count") {
      if (args.length !== 1) throw new EffectParseError(`${name} attend un nombre : ${name}(2)`);
      if (args[0] < 1) throw new EffectParseError(`${name}(${args[0]}) : le nombre doit être au moins 1`);
    } else if (spec.args === "pair") {
      if (args.length !== 2) throw new EffectParseError(`${name} attend deux nombres : ${name}(1/1)`);
    } else if (args.length) {
      throw new EffectParseError(`${name} ne prend pas d'argument`);
    }
    return { type: "call", name, args };
  }

  // expression := comparaison (and|or comparaison)*
  parseExpression() {
    let left = this.parseComparison();
    while (this.is("keyword", "and") || this.is("keyword", "or")) {
      const op = this.next().value;
      const right = this.parseComparison();
      left = { type: "logic", op, left, right };
    }
    return left;
  }

  parseComparison() {
    if (this.is("keyword", "not")) {
      this.next();
      return { type: "not", value: this.parseComparison() };
    }
    if (this.is("punct", "(")) {
      this.next();
      const inner = this.parseExpression();
      this.eat("punct", ")");
      return inner;
    }
    const left = this.parseOperand();
    if (this.is("op")) {
      const op = this.next().value;
      const right = this.parseOperand();
      return { type: "compare", op, left, right };
    }
    return { type: "truthy", value: left };
  }

  parseOperand() {
    const tk = this.next();
    if (!tk) throw new EffectParseError(`Expression incomplète dans : ${this.src}`);
    if (tk.type === "number") return { type: "literal", value: tk.value };
    if (tk.type === "string") return { type: "literal", value: tk.value };
    if (tk.type === "name") return { type: "path", path: String(tk.value).split(".") };
    throw new EffectParseError(`Opérande inattendu « ${tk.value} » dans : ${this.src}`);
  }
}

/**
 * Analyse un programme d'effet et renvoie son AST.
 * @throws {EffectParseError} sur toute erreur de syntaxe.
 */
export function parseEffect(source) {
  if (!source || !String(source).trim()) return [];
  const parser = new Parser(tokenize(String(source)), String(source));
  return parser.parseProgram();
}

/**
 * Vérifie tous les effets d'une carte. Renvoie la liste des erreurs
 * (vide si tout va bien) — utilisé par validate-cards.mjs pour que
 * les fautes de frappe soient détectées AVANT une partie.
 */
export function validateCardEffects(card) {
  const errors = [];
  if (!card.effect) return errors;
  for (const [trigger, program] of Object.entries(card.effect)) {
    if (!EFFECT_TRIGGERS.includes(trigger)) {
      errors.push(`${card.id} : déclencheur inconnu « ${trigger} » (attendu : ${EFFECT_TRIGGERS.join(", ")})`);
      continue;
    }
    try {
      parseEffect(program);
    } catch (err) {
      errors.push(`${card.id} [${trigger}] : ${err.message}`);
    }
  }
  return errors;
}
