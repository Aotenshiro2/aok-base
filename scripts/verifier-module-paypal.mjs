// Verifie le module Smart Money Technique vendu par le tunnel PayPal du 10%
// Club (src/lib/academie/club-paypal-pur.ts, 14/11/2026), hors ligne, sans
// PayPal ni base : le choix de l'offre, le prix lu en base seulement, la case
// de renonciation, la commande relue, la note de l'acces, l'email d'un achat
// de module, les alertes, et ce que les routes en font (lecture du code).
//
//   node scripts/verifier-module-paypal.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OFFRES_PAYPAL, OFFRE_SMT, URL_COMPTES_LIES, URL_CONDITIONS,
  corpsCommande, decisionCommande, htmlEmailClub, lienModulePayPal, lireCommande, modeleEmailClub, modeleEmailModule,
  montantAttendu, montantConforme, noteAcces, offreDeReference, offrePayPal, prixCommande, requeteCapture, texteAlerteEnAttente,
  texteAlerteNonNote, texteEmailClub,
} from '../src/lib/academie/club-paypal-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

const UUID = '11111111-2222-3333-4444-555555555555'
// Tirets longs, points de suspension, guillemets courbes, espaces insecables.
const TYPO = /[–—…“”‘’  ]/
const smt = OFFRES_PAYPAL.smt
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

bloc('choix de l offre : smt connu, le Club reste le defaut, le reste refuse', () => {
  assert.equal(offrePayPal('smt'), smt)
  assert.equal(offrePayPal(undefined), OFFRES_PAYPAL.club, 'pages d avant : le Club')
  assert.equal(offrePayPal(null), OFFRES_PAYPAL.club)
  assert.equal(offrePayPal('club'), OFFRES_PAYPAL.club)
  assert.equal(offrePayPal('coaching'), OFFRES_PAYPAL.coaching)
  for (const x of ['', 'SMT', 'module-smt', 'la-formation-complete', 'module-la-formation-complete', '__proto__', 'constructor',
    'toString', 'hasOwnProperty', 1, {}, [], true]) {
    assert.equal(offrePayPal(x), null, String(x))
  }
})

bloc('offre smt : son slug en base, aucun prix a defaut, la case exigee, le module ouvert', () => {
  assert.equal(OFFRE_SMT, 'module-la-formation-complete')
  assert.equal(smt.cle, 'smt')
  assert.equal(smt.slug, OFFRE_SMT)
  assert.equal(smt.prixDefautEur, null, 'prix lu en base seulement')
  assert.equal(smt.renonciation, true, 'contenu numerique ouvert tout de suite')
  assert.deepEqual(smt.module, { slug: 'la-formation-complete', titre: 'Smart Money Technique' })
  assert.ok(smt.description.length <= 127)
  assert.match(smt.description, /Smart Money Technique/)
  assert.doesNotMatch(smt.description, TYPO)
  assert.equal(OFFRES_PAYPAL.club.module, undefined, 'le Club n est pas une offre de module')
  assert.equal(OFFRES_PAYPAL.coaching.module, undefined)
  for (const o of Object.values(OFFRES_PAYPAL)) assert.ok(o.description.length <= 127, o.cle)
})

bloc('reference_id et en-tete de capture : propres a smt, essai compris, jamais partages', () => {
  const refs = Object.values(OFFRES_PAYPAL).flatMap(o => [o.reference, o.referenceEssai])
  assert.equal(new Set(refs).size, refs.length, 'aucune reference partagee')
  const prefixes = Object.values(OFFRES_PAYPAL).map(o => o.prefixeCapture)
  assert.equal(new Set(prefixes).size, prefixes.length, 'aucun prefixe de capture partage')
  assert.deepEqual(offreDeReference('module-smt'), { offre: smt, essai: false })
  assert.deepEqual(offreDeReference('module-smt-essai'), { offre: smt, essai: true })
  for (const x of ['MODULE-SMT', 'module-smt ', 'smt', OFFRE_SMT]) assert.equal(offreDeReference(x), null, String(x))
  assert.equal(requeteCapture('5o190127tn364715t', 'smt'), 'smt-capture-5O190127TN364715T')
  assert.equal(requeteCapture('5o190127tn364715t'), 'club10-capture-5O190127TN364715T', 'le Club garde son en-tete')
})

bloc('prix : celui de la base (1 500), 1 EUR en essai, rien sans l offre en base', () => {
  assert.deepEqual(prixCommande({ offre: smt, essai: false, ligne: { prix: 1500 } }), { ok: true, montantEur: 1500 })
  assert.deepEqual(prixCommande({ offre: smt, essai: true, ligne: { prix: 1500 } }), { ok: true, montantEur: 1 })
  assert.deepEqual(prixCommande({ offre: smt, essai: false, ligne: null }), { ok: false }, 'offre absente')
  assert.deepEqual(prixCommande({ offre: smt, essai: true, ligne: null }), { ok: false }, 'meme l essai : l acces ne pourrait pas etre pose')
  assert.deepEqual(prixCommande({ offre: smt, essai: false, ligne: { prix: null } }), { ok: false }, 'offre sans prix')
  assert.deepEqual(prixCommande({ offre: smt, essai: false, ligne: undefined }), { ok: false })
  assert.equal(montantAttendu({ essai: false, prixBase: null, offre: smt }), null, 'jamais le 1 999 du Club')
  assert.equal(montantAttendu({ essai: false, prixBase: 1500, offre: smt }), 1500)
})

bloc('qui commande : vente fermee = essai admin seulement, ouverte = tous, l essai reste admin', () => {
  assert.equal(decisionCommande({ ouvert: false, essai: false, connecte: true, admin: true }), 'ferme')
  assert.equal(decisionCommande({ ouvert: false, essai: true, connecte: false, admin: false }), 'jeton')
  assert.equal(decisionCommande({ ouvert: false, essai: true, connecte: true, admin: false }), 'droit')
  assert.equal(decisionCommande({ ouvert: false, essai: true, connecte: true, admin: true }), 'ok')
  assert.equal(decisionCommande({ ouvert: true, essai: false, connecte: false, admin: false }), 'ok')
  assert.equal(decisionCommande({ ouvert: true, essai: true, connecte: true, admin: false }), 'droit')
})

bloc('commande smt : sa reference, sa description, le montant de la base', () => {
  const c = corpsCommande({ titulaire: { userId: UUID }, montantEur: 1500, essai: false, offre: smt })
  const u = c.purchase_units[0]
  assert.equal(u.reference_id, 'module-smt')
  assert.equal(u.description, 'Module Smart Money Technique - AO Knowledge')
  assert.equal(u.custom_id, `u:${UUID}`)
  assert.deepEqual(u.amount, { currency_code: 'EUR', value: '1500.00' })
  assert.equal(c.intent, 'CAPTURE')
  assert.equal(c.application_context.shipping_preference, 'NO_SHIPPING')
  const e = corpsCommande({ titulaire: { email: 'eleve@exemple.fr' }, montantEur: 1, essai: true, offre: smt })
  assert.equal(e.purchase_units[0].reference_id, 'module-smt-essai')
  assert.equal(e.purchase_units[0].custom_id, 'e:eleve@exemple.fr')
  assert.deepEqual(e.purchase_units[0].amount, { currency_code: 'EUR', value: '1.00' })
})

const commandeSmt = (extra = {}) => ({
  id: '7AB12345CD678901E', status: 'APPROVED', create_time: '2026-11-14T21:00:00Z',
  payer: { email_address: 'payeur@paypal.fr', name: { given_name: 'Eleve' } },
  purchase_units: [{ reference_id: 'module-smt', custom_id: 'e:eleve@exemple.fr', amount: { currency_code: 'EUR', value: '1500.00' }, ...extra }],
})

bloc('commande relue : l offre vient de PayPal, le montant se verifie contre le prix en base', () => {
  const r = lireCommande(commandeSmt())
  assert.equal(r.ok, true)
  assert.equal(r.commande.offre, 'smt')
  assert.equal(r.commande.essai, false)
  assert.deepEqual(r.commande.titulaire, { email: 'eleve@exemple.fr' })
  assert.equal(r.commande.creeLe.toISOString(), '2026-11-14T21:00:00.000Z', 'la renonciation datee de la commande')
  assert.equal(montantConforme(r.commande, 1500), true)
  assert.equal(montantConforme(r.commande, null), false, 'offre absente : jamais capturee')
  assert.equal(montantConforme(r.commande, 1999), false, 'pas au prix du Club')
  // Une commande a 1 500 EUR qui se dit Club ne passe pas.
  const club = lireCommande(commandeSmt({ reference_id: 'club-10' }))
  assert.equal(club.commande.offre, 'club')
  assert.equal(montantConforme(club.commande, 1999), false)
  const essai = lireCommande(commandeSmt({ reference_id: 'module-smt-essai', custom_id: `u:${UUID}`, amount: { currency_code: 'EUR', value: '1.00' } }))
  assert.equal(essai.commande.essai, true)
  assert.equal(essai.commande.offre, 'smt')
  assert.equal(montantConforme(essai.commande, null), true, 'essai a 1 EUR : le prix en base ne compte pas')
  const usd = lireCommande(commandeSmt({ amount: { currency_code: 'USD', value: '1500.00' } }))
  assert.equal(montantConforme(usd.commande, 1500), false, 'EUR seulement')
})

bloc('note de l acces : le module, la commande, la capture, le montant, la renonciation', () => {
  const base = { orderId: '7AB12345CD678901E', captureId: '9XY12345CD678901Z', centimes: 150000, essai: false, payeurEmail: 'eleve@exemple.fr', email: 'eleve@exemple.fr', offre: 'smt' }
  const t = noteAcces({ ...base, renonciationLe: new Date('2026-11-14T21:00:00Z') })
  assert.equal(t, 'PayPal Smart Money Technique : commande 7AB12345CD678901E, capture 9XY12345CD678901Z, 1500.00 EUR')
  assert.doesNotMatch(t, /seances/)
  assert.match(noteAcces({ ...base, renonciationLe: null }), /renonciation datee de la capture/)
  assert.match(noteAcces({ ...base, renonciationLe: null, essai: true, centimes: 100 }), /ACHAT TEST/)
  assert.match(noteAcces({ ...base, renonciationLe: null, payeurEmail: 'autre@paypal.fr' }), /email du payeur PayPal : autre@paypal\.fr/)
})

bloc('email du module : ce qui est ouvert, ou entrer, avec quelle adresse, le 4x et le recu PayPal', () => {
  const lien = lienModulePayPal(smt.module.slug)
  assert.equal(lien, 'https://aoknowledge.com/academie/la-formation-complete')
  const m = modeleEmailModule({ email: 'eleve@exemple.fr', essai: false, montant: '1 500 euros', prenom: 'Eleve', titre: smt.module.titre, lien })
  assert.equal(m.sujet, 'Le module Smart Money Technique est ouvert')
  assert.deepEqual(m.bouton, { texte: 'Ouvrir le module', url: lien })
  const texte = texteEmailClub(m)
  const html = htmlEmailClub(m)
  for (const t of [texte, html]) {
    assert.ok(t.startsWith('Bonjour Eleve,') || t.includes('>Bonjour Eleve,<'))
    assert.ok(t.includes('1 500 euros pour le module « Smart Money Technique »'))
    assert.match(t, /ouvert sur votre compte AOKnowledge, à vie/)
    assert.ok(t.includes(lien))
    assert.ok(t.includes('eleve@exemple.fr'))
    assert.match(t, /adresse de votre achat\. C('|&#39;)est elle qui ouvre l('|&#39;)accès/)
    assert.ok(t.includes(URL_COMPTES_LIES))
    assert.ok(t.includes(URL_CONDITIONS))
    assert.match(t, /4 fois, les échéances sont gérées par PayPal/)
    assert.match(t, /renonciation à votre droit de rétractation/)
    assert.match(t, /Votre reçu, lui, vient de PayPal\./)
    assert.match(t, /« Mes cours »/)
    assert.ok(t.includes('Brice et Mélanie'), 'meme signature que le mail du Club')
    assert.doesNotMatch(t, /rubrique Achats/, 'le recu vient de PayPal, pas de Mon espace')
    assert.doesNotMatch(t, /10% Club|formation complète|La Formation/, 'ni le Club, ni le nom en base')
    assert.doesNotMatch(t, TYPO, 'typographie simple')
  }
  assert.ok(html.includes(`<a href="${lien}"`))
  assert.doesNotMatch(texte, /\{lien:/)
  assert.equal(modeleEmailModule({ email: 'a@b.fr', essai: true, titre: 'X', lien }).sujet, '[Essai] Le module X est ouvert')
  assert.ok(texteEmailClub(modeleEmailModule({ email: 'a@b.fr', essai: false, titre: 'X', lien })).startsWith('Bonjour,\n\nMerci, votre paiement est bien passé pour le module « X ».'))
  const piege = htmlEmailClub(modeleEmailModule({ email: '<script>@x.fr', essai: false, titre: smt.module.titre, lien }))
  assert.doesNotMatch(piege, /<script>/)
  // Le mail du Club ne bouge pas.
  assert.equal(modeleEmailClub({ email: 'a@b.fr', essai: false }).sujet, 'Votre accès au 10% Club est ouvert')
})

bloc('alertes de l equipe : en attente et non note, au nom du module, aucun secret', () => {
  const base = { orderId: '7AB12345CD678901E', captureId: '9XY12345CD678901Z', centimes: 150000, essai: false, email: 'eleve@exemple.fr', offre: 'smt' }
  const attente = texteAlerteEnAttente(base)
  assert.match(attente, /^Smart Money Technique : paiement PayPal EN ATTENTE\./)
  assert.match(attente, /acces prevu pour eleve@exemple\.fr/)
  assert.match(attente, /L'acces n'est PAS ouvert/)
  assert.match(attente, /\/api\/club\/paypal\/capturer \{"order_id":"7AB12345CD678901E"\}/)
  const nonNote = texteAlerteNonNote(base)
  assert.match(nonNote, /^Smart Money Technique : paiement PayPal ENCAISSE mais NON NOTE en base\./)
  for (const t of [attente, nonNote]) assert.doesNotMatch(t, /secret|client_id|Bearer/i)
})

bloc('routes : la case exigee a la commande, l email du module a la capture, pas celui du Club', () => {
  const commande = lire('../src/app/api/club/paypal/commande/route.ts')
  assert.match(commande, /if \(offre\.renonciation && corps\.renonciation !== true\) return refus\('renonciation', 400\)/)
  assert.match(commande, /if \(!essai \|\| offre\.prixDefautEur === null\)/, 'offre sans defaut : la base est lue, essai compris')
  const capture = lire('../src/app/api/club/paypal/capturer/route.ts')
  assert.match(capture, /if \(r\.cree && offre\.cle === 'club'\) \{/, 'le mail du Club pour le Club seulement')
  assert.match(capture, /if \(r\.cree && offre\.module\) \{[\s\S]*?modeleEmailModule\(\{[\s\S]*?titre: offre\.module\.titre, lien: lienModulePayPal\(offre\.module\.slug\)/)
  assert.match(capture, /renonciationLe: offre\.renonciation \? c\.creeLe \?\? new Date\(\) : null/)
  assert.match(capture, /slug: offre\.slug/, 'l acces est pose sur l offre de la commande')
})

bloc('vente publique : SMT_PAYPAL_PUBLIC, fermee par defaut, une variable par offre', () => {
  const lib = lire('../src/lib/academie/club-paypal.ts')
  const fonction = lib.slice(lib.indexOf('export function ventePublique'))
  const corps = fonction.slice(0, fonction.indexOf('\n}\n'))
  assert.match(corps, /if \(offre === 'smt'\) return process\.env\.SMT_PAYPAL_PUBLIC\?\.trim\(\) === '1'/)
  assert.match(corps, /if \(offre === 'coaching'\) return process\.env\.COACHING_PAYPAL_PUBLIC\?\.trim\(\) === '1'/)
  assert.match(corps, /return ventePubliqueClub\(\)/)
  const get = lire('../src/app/api/club/paypal/route.ts')
  assert.match(get, /ouvert: ventePublique\(offre\.cle\), offre: offre\.cle/, 'le site recoit l offre comprise')
})

console.log(`\n${n} blocs ok`)
