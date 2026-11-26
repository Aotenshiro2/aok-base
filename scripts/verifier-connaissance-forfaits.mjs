// LA CONNAISSANCE DES FORFAITS DE L'AGENT DES MEMBRES DU LIVE CLUB (Black
// Friday 2026, decisions de Brice du 22 au 26/11). Lit seulement les fichiers :
// docs/connaissances (live-club, dix-pour-cent-club), connaissances.generated.ts,
// prompt-membre.ts, politique-information.ts. Aucune base, aucun reseau.
//   node scripts/verifier-connaissance-forfaits.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

await bloc('connaissance des forfaits de l agent : 3 mois a 239 € (renouvele a 239 €) puis 267 €, 6 mois sans prix, mensuel a 99 €, aucun ancien prix ni lien', () => {
  const md = lire('../docs/connaissances/live-club.md')
  const gen = lire('../src/lib/connaissances.generated.ts')
  const prompt = lire('../src/lib/liveclub/prompt-membre.ts')
  for (const [nom, x] of [['md', md], ['generated', gen], ['prompt', prompt]]) {
    assert.doesNotMatch(x, /249 ?€|444 ?€|498 ?€|534 ?€|297 ?€|aFadR80Si4Vc1jf4SKbsc08|5kQcN444ubjAaTP2KCbsc09|7sYcN4eJ8cnEfa5ad4bsc0e|9B68wO9oOgDU2njgBsbsc0g|7sYcN4e|9B68wO9|83 € par mois|74 € par mois/, nom)
    assert.doesNotMatch(x, /6 mois (à|a) \d|6 mois : \d|six mois (à|a) \d/i, nom)
  }
  for (const x of [md, gen]) {
    assert.ok(x.includes('239 €') && x.includes('267 €'))
    assert.ok(x.includes('https://buy.stripe.com/00w00i6cC4Vc3rnetkbsc0d'), 'lien d Adil')
    assert.ok(x.includes('https://aoknowledge.com/live-club,'), 'apres le 30/11 : la page live-club')
    assert.ok(x.includes('tu ne donnes plus de lien de paiement direct pour le forfait'))
    assert.ok(x.includes('https://aoknowledge.com/black-friday'))
    assert.ok(x.includes('5 semaines avant') && x.includes('1 semaine avant'))
    assert.ok(x.includes('se renouvelle à 239 €'), 'achat a 239 : renouvellement a 239')
    assert.doesNotMatch(x, /239 €[^.;]*se renouvelle à 267/, 'jamais 239 renouvele a 267')
    assert.doesNotMatch(x, /à l'achat comme au renouvellement/)
    assert.ok(x.includes("Le forfait de 6 mois n'est pas mis en avant"))
    assert.ok(x.includes('ni réduction en plus ni code promo'))
  }
  // Mensuel a 99 EUR (Brice, 26/11) dans tout ce que l'agent du bot lit ; plus aucun 139.
  const dix = lire('../docs/connaissances/dix-pour-cent-club.md')
  const politique = lire('../src/lib/politique-information.ts')
  for (const [nom, x] of [['md', md], ['generated', gen], ['prompt', prompt], ['dix', dix], ['politique', politique]]) {
    assert.doesNotMatch(x, /139/, nom)
    assert.doesNotMatch(x, /premium futur|futur premium/i, nom)
  }
  assert.ok(md.includes('- 99 € par mois, sans engagement'))
  assert.match(politique, /texteLiveClub: "Le prix du mensuel est de 99 euros par mois/)
  assert.match(prompt, /Le forfait de 6 mois n'est pas mis en avant : tu n'en parles pas de toi-même et, s'il le demande, tu ne donnes ni prix ni lien/)
})


console.log(`\n${n} blocs ok`)
process.exit(0)
