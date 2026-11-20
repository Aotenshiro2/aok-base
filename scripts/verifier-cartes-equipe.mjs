// Tests des CARTES A BOUTONS ENVOYEES A PLUSIEURS COMPTES DE L'EQUIPE
// (21/11/2026, Brice : ne plus rester « en suspens » sur une carte a laquelle
// Mel a deja repondu) :
// - la ligne de fin (qui, quand en heure de Paris, quoi), sans emoji ni tiret long ;
// - le choix des cartes a fermer (toutes sauf celle cliquee, sans doublon) ;
// - le clic tardif (texteLotsDejaDecides avec la date) ;
// - le classement des refus de Telegram a l'edition ;
// - le cablage de la carte des lots (lecture des sources) : message_id gardes
//   a l'envoi, fermeture APRES la decision et seulement si elle a abouti,
//   jamais d'annulation sur un echec de fermeture.
// Aucune base, aucun reseau.
// node scripts/verifier-cartes-equipe.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const C = await import('../src/lib/cartes-equipe-pur.ts')
const L = await import('../src/lib/liveclub/lots-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const sain = (t, nom) => {
  assert.ok(!/[—–…“”‘’•]/.test(t), `${nom} : tiret long, points de suspension ou guillemets courbes`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
}

// 20/11/2026 13:02 UTC = 14 h 02 a Paris (heure d'hiver).
const LE = new Date('2026-11-20T13:02:00Z')

bloc('momentParis : heure de Paris, jour et mois sur deux chiffres', () => {
  assert.equal(C.momentParis(LE), 'le 20/11 à 14 h 02')
  assert.equal(C.momentParis('2026-07-01T06:05:00Z'), 'le 01/07 à 08 h 05', 'heure d ete')
  assert.equal(C.momentParis('2026-11-20T23:30:00Z'), 'le 21/11 à 00 h 30', 'changement de jour a Paris')
  assert.equal(C.momentParis(null), null)
  assert.equal(C.momentParis('pas une date'), null)
})

bloc('ligne de decision : oui, non, sans nom, sans date', () => {
  const oui = C.ligneDecisionEquipe({ verbe: 'oui', par: 'Mel', le: LE, quoi: 'lots notés faits' })
  assert.equal(oui, 'Validé par Mel, le 20/11 à 14 h 02 : lots notés faits.')
  const non = C.ligneDecisionEquipe({ verbe: 'non', par: 'Mel', le: LE })
  assert.equal(non, 'Mel a répondu non, le 20/11 à 14 h 02.')
  assert.equal(C.ligneDecisionEquipe({ verbe: 'non', par: null, le: LE }), "Quelqu'un de l'équipe a répondu non, le 20/11 à 14 h 02.")
  assert.equal(C.ligneDecisionEquipe({ verbe: 'oui', par: '  ', le: null }), "Validé par quelqu'un de l'équipe.")
  for (const t of [oui, non]) sain(t, t)
})

bloc('ligne de decision des lots', () => {
  assert.equal(L.ligneDecisionLots('lots_confirmes', 'Mel', LE), 'Validé par Mel, le 20/11 à 14 h 02 : lots notés faits.')
  assert.equal(L.ligneDecisionLots('lots_pas_vus', 'Brice', LE), 'Brice a répondu non, le 20/11 à 14 h 02.')
  assert.equal(L.ligneDecisionLots(null, 'Mel', LE), null, 'carte introuvable : rien a ecrire')
})

bloc('clic tardif : qui a deja decide et quand', () => {
  assert.equal(L.texteLotsDejaDecides('lots_confirmes', 'Mel', LE), 'Déjà traité par Mel, le 20/11 à 14 h 02 : lots notés faits.')
  assert.equal(L.texteLotsDejaDecides('lots_pas_vus', null, LE), 'Déjà traité, le 20/11 à 14 h 02 : lots pas encore vus.')
  // L'ancienne forme (sans date) reste la meme.
  assert.equal(L.texteLotsDejaDecides('lots_confirmes', 'Mélanie'), 'Déjà traité par Mélanie : lots notés faits.')
  assert.equal(L.texteLotsDejaDecides(null, null, LE), 'Cette carte est introuvable.')
  assert.ok(L.texteLotsDejaDecides('lots_confirmes', 'Mel', LE).length <= 200, 'tient dans une notification (200 caracteres)')
})

bloc('clic tardif : ligne de fin seulement pour une decision de plus de 60 s', () => {
  assert.equal(L.DELAI_DECISION_SURE_MS, 60_000)
  const apres = (s) => new Date(LE.getTime() + s * 1000)
  // Decision encore en cours (apresOui peut l'annuler) : pas de ligne, boutons seuls retires.
  assert.equal(L.ligneClicTardifLots('lots_confirmes', 'Mel', LE, apres(5)), null)
  assert.equal(L.ligneClicTardifLots('lots_confirmes', 'Mel', LE, apres(60)), null)
  assert.equal(L.ligneClicTardifLots('lots_confirmes', 'Mel', LE, apres(61)), 'Validé par Mel, le 20/11 à 14 h 02 : lots notés faits.')
  assert.equal(L.ligneClicTardifLots('lots_pas_vus', 'Mel', LE, apres(3600)), 'Mel a répondu non, le 20/11 à 14 h 02.')
  assert.equal(L.ligneClicTardifLots('lots_confirmes', 'Mel', null, apres(3600)), null, 'date illisible')
  assert.equal(L.ligneClicTardifLots(null, 'Mel', LE, apres(3600)), null)
})

bloc('cartes a fermer : toutes sauf la cliquee, illisibles et doublons ecartes', () => {
  const cartes = [{ chat: 11, message: 101 }, { chat: 22, message: 202 }, { chat: 22, message: 202 }, { chat: 0, message: 5 }, { chat: 33 }, 'x', null]
  assert.deepEqual(C.lireCartesEquipe(cartes), [{ chat: 11, message: 101 }, { chat: 22, message: 202 }])
  assert.deepEqual(C.cartesAFermer(C.lireCartesEquipe(cartes), { chat: 11, message: 101 }), [{ chat: 22, message: 202 }])
  // Meme chat, autre message (carte renvoyee) : fermee aussi.
  assert.deepEqual(C.cartesAFermer([{ chat: 11, message: 101 }, { chat: 11, message: 150 }], { chat: 11, message: 101 }), [{ chat: 11, message: 150 }])
  // Message de la carte cliquee inconnu : toutes les cartes se ferment (aucune n'est la cliquee).
  assert.deepEqual(C.cartesAFermer([{ chat: 11, message: 101 }], { chat: 11, message: null }), [{ chat: 11, message: 101 }])
  assert.deepEqual(C.cartesAFermer([], { chat: 11, message: 101 }), [])
  assert.deepEqual(C.lireCartesEquipe(undefined), [], 'declaration d avant le correctif')
  assert.deepEqual(C.lireCartesEquipe({ chat: 1, message: 2 }), [])
})

bloc('message_id rendu par sendMessage', () => {
  assert.equal(C.messageIdEnvoye({ message_id: 42, chat: { id: 1 } }), 42)
  assert.equal(C.messageIdEnvoye({ message_id: '42' }), null)
  assert.equal(C.messageIdEnvoye(null), null)
  assert.equal(C.messageIdEnvoye(true), null)
})

bloc('texte de la carte fermee : carte puis ligne, 4 096 caracteres au plus', () => {
  assert.equal(C.texteCarteFermee('Carte', 'Fin.'), 'Carte\n\nFin.')
  const long = C.texteCarteFermee('a'.repeat(5000), 'Validé par Mel.')
  assert.ok(long.length <= 4096)
  assert.ok(long.endsWith('...\n\nValidé par Mel.'))
})

bloc('refus de Telegram a l edition', () => {
  assert.equal(C.classerRefusEdition('Bad Request: message is not modified: specified new message content and reply markup are exactly the same'), 'deja')
  assert.equal(C.classerRefusEdition('Bad Request: message to edit not found'), 'perdue')
  assert.equal(C.classerRefusEdition("Bad Request: message can't be edited"), 'perdue')
  assert.equal(C.classerRefusEdition('Forbidden: bot was blocked by the user'), 'perdue')
  assert.equal(C.classerRefusEdition('Too Many Requests: retry after 3'), 'autre')
  assert.equal(C.classerRefusEdition('reseau'), 'autre')
})

bloc('cablage de la carte des lots', () => {
  const lots = lire('src/lib/liveclub/lots.ts')
  const util = lire('src/lib/cartes-equipe.ts')
  // A l'envoi : chaque carte partie (message_id) est gardee dans details.cartes de la declaration.
  assert.match(lots, /envoyerCarteEquipe\(chat, texte, clavierCarteLots\(id\)\)/)
  assert.match(lots, /jsonb_build_object\('cartes', \$\{JSON\.stringify\(cartes\)\}::jsonb\)/)
  // Chaque carte est notee juste apres SON envoi (dans la boucle), jamais avec un message_id inconnu.
  const boucle = lots.slice(lots.indexOf('for (const dest of equipe)'), lots.indexOf('return livres'))
  assert.match(boucle, /if \(partie\.message !== null\) \{[\s\S]{0,120}cartes\.push[\s\S]{0,300}jsonb_build_object\('cartes'/)
  assert.match(util, /return \{ chat, message: messageIdEnvoye\(r\.resultat\) \}/)
  assert.ok(!/message \?\? 0/.test(util))
  // La fiche personne ne montre jamais details.cartes (identifiants Telegram de l'equipe).
  assert.match(lire('src/lib/fiche-personne.ts'), /left\(\(x\.details - 'cartes'\)::text, 160\)/)
  // Le clic tardif passe par la regle des 60 s.
  assert.match(lots, /ligneClicTardifLots\(d\.regle, d\.par, d\.le, new Date\(\)\)/)
  // La decision relit ces cartes, verrou inchange (for update).
  assert.match(lots, /cartes: lireCartesEquipe\(details\.cartes\)/)
  assert.match(lots, /regle = 'lots_declares' and resultat = 'fait'\n\s+for update/)
  // La fermeture vient APRES la decision dite au cliqueur, seulement si elle a abouti, et son echec est garde.
  const i = lots.indexOf("await tgCockpit('sendMessage', { chat_id: chatIdEquipe, text: texte.texte })")
  const j = lots.indexOf('await fermerAutresCartesLots(')
  assert.ok(i > 0 && j > i, 'fermeture apres le message de la decision')
  assert.match(lots, /if \(texte\.ok\) \{\n\s+await fermerAutresCartesLots\([\s\S]{0,200}\.catch\(/)
  // Aucun chemin de fermeture n'annule la decision.
  const fermer = lots.slice(lots.indexOf('async function fermerAutresCartesLots'), lots.indexOf('async function texteCarteGardee'))
  assert.ok(!/annulerDecision/.test(fermer))
  // Clic tardif : la carte cliquee se ferme avec la ligne de la decision.
  assert.match(lots, /texteLotsDejaDecides\(d\.regle, d\.par, d\.le\)/)
  // L'utilitaire ne jette pas et ne logue ni identifiant ni texte.
  assert.ok(!/console\.\w+\([^)]*c\.chat/.test(util))
  assert.ok(!/console\.\w+\([^)]*o\.carte/.test(util))
  assert.match(util, /catch \{\n\s+bilan\.autres\+\+/)
})

console.log(`\n${n} blocs ok`)
