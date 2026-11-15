// Verifie la vente des parties de Smart Money Technique seules (15/11/2026, go
// de Brice : 850 EUR la partie, 1 500 EUR les deux d'un coup), hors ligne,
// sans PayPal, Stripe ni base : les deux offres du tunnel PayPal (prix lu en
// base seulement, case de renonciation, references propres), la session
// Stripe d'une partie (offre validee, libelle), la lecture de la session au
// webhook, l'email, puis ce que les routes et les requetes en font (lecture
// du code).
//
//   node scripts/verifier-parties-smt.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OFFRES_PAYPAL, OFFRE_SMT, OFFRE_SMT_PARTIE_1, OFFRE_SMT_PARTIE_2,
  corpsCommande, lienModulePayPal, lireCommande, modeleEmailModule, montantConforme, noteAcces, offreDeReference, offrePayPal,
  prixCommande, requeteCapture, texteAlerteEnAttente, texteEmailClub,
} from '../src/lib/academie/club-paypal-pur.ts'
import { corpsSession, lireAchat, offrePartie } from '../src/lib/academie/achat-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

// Tirets longs, points de suspension, guillemets courbes, espaces insecables.
const TYPO = /[\u2013\u2014\u2026\u201c\u201d\u2018\u2019\u00a0\u202f]/
const p1 = OFFRES_PAYPAL['smt-partie-1']
const p2 = OFFRES_PAYPAL['smt-partie-2']
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

bloc('offres PayPal des parties : leur slug en base, aucun prix a defaut, la case exigee, le module ouvert', () => {
  assert.equal(OFFRE_SMT_PARTIE_1, 'module-la-formation-complete-partie-1')
  assert.equal(OFFRE_SMT_PARTIE_2, 'module-la-formation-complete-partie-2')
  assert.equal(offrePayPal('smt-partie-1'), p1)
  assert.equal(offrePayPal('smt-partie-2'), p2)
  for (const x of ['smt-partie-3', 'smt-partie', 'partie-1', OFFRE_SMT_PARTIE_1, 'SMT-PARTIE-1']) assert.equal(offrePayPal(x), null, x)
  for (const [o, num, slug] of [[p1, 1, OFFRE_SMT_PARTIE_1], [p2, 2, OFFRE_SMT_PARTIE_2]]) {
    assert.equal(o.slug, slug)
    assert.notEqual(o.slug, OFFRE_SMT, 'jamais l offre du module entier')
    assert.equal(o.prixDefautEur, null, 'prix lu en base seulement')
    assert.equal(o.renonciation, true)
    assert.deepEqual(o.module, { slug: 'la-formation-complete', titre: `Smart Money Technique, partie ${num}` })
    assert.equal(o.nom, `Smart Money Technique, partie ${num}`)
    assert.ok(o.description.length <= 127)
    assert.match(o.description, new RegExp(`^Smart Money Technique, partie ${num} \\(épisodes`))
    assert.doesNotMatch(o.description, TYPO)
  }
})

bloc('references PayPal : propres a chaque partie, essai compris, jamais partagees', () => {
  const refs = Object.values(OFFRES_PAYPAL).flatMap(o => [o.reference, o.referenceEssai])
  assert.equal(new Set(refs).size, refs.length)
  const prefixes = Object.values(OFFRES_PAYPAL).map(o => o.prefixeCapture)
  assert.equal(new Set(prefixes).size, prefixes.length)
  assert.deepEqual([p1.reference, p1.referenceEssai, p2.reference, p2.referenceEssai],
    ['module-smt-partie-1', 'module-smt-partie-1-essai', 'module-smt-partie-2', 'module-smt-partie-2-essai'])
  assert.deepEqual(offreDeReference('module-smt-partie-2'), { offre: p2, essai: false })
  assert.deepEqual(offreDeReference('module-smt-partie-1-essai'), { offre: p1, essai: true })
  assert.equal(offreDeReference('module-smt-partie-3'), null)
  assert.equal(requeteCapture('5o190127tn364715t', 'smt-partie-1'), 'smt-p1-capture-5O190127TN364715T')
  assert.equal(requeteCapture('5o190127tn364715t', 'smt-partie-2'), 'smt-p2-capture-5O190127TN364715T')
  assert.ok(requeteCapture('A'.repeat(40), 'smt-partie-2').length <= 108, 'PayPal-Request-Id assez court')
})

bloc('prix PayPal : celui de l offre en base, rien sans elle (essai compris), 1 EUR en essai', () => {
  for (const offre of [p1, p2]) {
    assert.deepEqual(prixCommande({ offre, essai: false, ligne: null }), { ok: false }, 'offre absente : rien ne se vend')
    assert.deepEqual(prixCommande({ offre, essai: true, ligne: null }), { ok: false }, 'meme en essai')
    assert.deepEqual(prixCommande({ offre, essai: false, ligne: { prix: null } }), { ok: false }, 'sans prix : rien')
    assert.deepEqual(prixCommande({ offre, essai: false, ligne: { prix: 850 } }), { ok: true, montantEur: 850 })
    assert.deepEqual(prixCommande({ offre, essai: true, ligne: { prix: 850 } }), { ok: true, montantEur: 1 })
  }
  const corps = corpsCommande({ titulaire: { email: 'eleve@exemple.fr' }, montantEur: 850, essai: false, offre: p2 })
  const u = corps.purchase_units[0]
  assert.equal(u.reference_id, 'module-smt-partie-2')
  assert.deepEqual(u.amount, { currency_code: 'EUR', value: '850.00' })
  assert.equal(corpsCommande({ titulaire: { email: 'a@b.fr' }, montantEur: 1, essai: true, offre: p1 }).purchase_units[0].reference_id,
    'module-smt-partie-1-essai')
})

bloc('capture : la commande relue porte la partie, et le montant de SON offre', () => {
  const commande = {
    id: '7AB12345CD678901E', status: 'APPROVED', create_time: '2026-11-20T10:00:00Z',
    purchase_units: [{ reference_id: 'module-smt-partie-2', custom_id: 'e:eleve@exemple.fr', amount: { currency_code: 'EUR', value: '850.00' } }],
  }
  const r = lireCommande(commande)
  assert.ok(r.ok)
  assert.equal(r.commande.offre, 'smt-partie-2')
  assert.equal(montantConforme(r.commande, 850), true)
  assert.equal(montantConforme(r.commande, 1500), false, 'jamais le prix du module entier')
  assert.equal(montantConforme(r.commande, null), false, 'offre absente : jamais capturee')
  const note = noteAcces({ orderId: r.commande.orderId, captureId: '9XY12345CD678901Z', centimes: 85000, essai: false, renonciationLe: new Date(), payeurEmail: null, email: 'eleve@exemple.fr', offre: 'smt-partie-2' })
  assert.match(note, /^PayPal Smart Money Technique, partie 2 : commande 7AB12345CD678901E, capture 9XY12345CD678901Z, 850\.00 EUR$/)
  assert.match(texteAlerteEnAttente({ orderId: 'X', captureId: 'Y', centimes: 85000, essai: false, email: null, offre: 'smt-partie-1' }),
    /^Smart Money Technique, partie 1 : paiement PayPal EN ATTENTE\./)
})

bloc('email PayPal d une partie : au nom de la partie, lien vers la page du module', () => {
  const lien = lienModulePayPal(p2.module.slug)
  const m = modeleEmailModule({ email: 'eleve@exemple.fr', essai: false, montant: '850 euros', prenom: 'Eleve', titre: p2.module.titre, lien })
  assert.equal(m.sujet, 'Le module Smart Money Technique, partie 2 est ouvert')
  const t = texteEmailClub(m)
  assert.ok(t.includes('850 euros pour le module « Smart Money Technique, partie 2 »'))
  assert.ok(t.includes('https://aoknowledge.com/academie/la-formation-complete'))
  assert.doesNotMatch(t, TYPO)
})

bloc('carte : l offre envoyee par la page doit nommer une partie de CE module', () => {
  assert.equal(offrePartie('module-la-formation-complete-partie-1', 'la-formation-complete'), 'module-la-formation-complete-partie-1')
  assert.equal(offrePartie('module-la-formation-complete-partie-2', 'la-formation-complete'), 'module-la-formation-complete-partie-2')
  for (const x of [
    'module-la-formation-complete', 'module-la-formation-complete-partie-0', 'module-la-formation-complete-partie-100',
    'module-la-formation-complete-partie-1 ', 'module-autre-partie-1', 'formation-complete', 'module-la-formation-complete-partie-x',
    'MODULE-la-formation-complete-partie-1', '', null, 3, {}, `module-${'a'.repeat(70)}-partie-1`,
  ]) assert.equal(offrePartie(x, 'la-formation-complete'), null, String(x))
  assert.equal(offrePartie('module-la-formation-complete-partie-1', 'journaling'), null, 'pas une partie de ce module')
})

bloc('session Stripe d une partie : son prix Stripe, son offre dans les metadonnees, libelle au nom de la partie', () => {
  const offre = {
    moduleSlug: 'la-formation-complete', moduleTitre: 'La Formation complète', offreSlug: OFFRE_SMT_PARTIE_2,
    stripePriceId: 'price_partie2', partie: 'Smart Money Technique, partie 2',
  }
  const c = corpsSession(offre, { retourUrl: 'https://aoknowledge.com/academie/la-formation-complete?achat_session={CHECKOUT_SESSION_ID}', userId: null, email: null, essai: false })
  assert.equal(c.get('line_items[0][price]'), 'price_partie2')
  assert.equal(c.get('metadata[academie_module]'), 'la-formation-complete')
  assert.equal(c.get('metadata[academie_offre]'), OFFRE_SMT_PARTIE_2)
  assert.equal(c.get('payment_intent_data[metadata][academie_offre]'), OFFRE_SMT_PARTIE_2)
  assert.equal(c.get('payment_intent_data[description]'), 'Académie AOK : Smart Money Technique, partie 2')
  assert.match(c.get('payment_intent_data[description]'), /^Académie AOK/, 'le pipeline du cockpit la classe academie-module')
  const entier = corpsSession({ ...offre, offreSlug: OFFRE_SMT, partie: undefined }, { retourUrl: 'x', userId: null, email: null, essai: false })
  assert.equal(entier.get('payment_intent_data[description]'), 'Académie AOK : La Formation complète', 'le module entier inchange')
  // Le webhook relit l'offre dans la session : l'acces se pose sur l'offre de la partie.
  const session = {
    id: 'cs_test_partie0000000002', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 85000, created: 1795000000,
    metadata: { source: 'academie', academie_module: 'la-formation-complete', academie_offre: OFFRE_SMT_PARTIE_2, essai: '0' },
    customer_details: { email: 'Eleve@Exemple.fr' }, consent: { terms_of_service: 'accepted' },
  }
  const lu = lireAchat(session)
  assert.ok(lu.ok)
  assert.equal(lu.achat.offreSlug, OFFRE_SMT_PARTIE_2)
  assert.equal(lu.achat.montantEur, 850)
})

bloc('requetes : la partie en vente verifiee en base, les sections rendues aux pages', () => {
  const r = lire('../src/lib/academie/requetes.ts')
  const sql = r.slice(r.indexOf('export const SQL_OFFRE_PARTIE_EN_VENTE'), r.indexOf('`', r.indexOf('`', r.indexOf('export const SQL_OFFRE_PARTIE_EN_VENTE')) + 1))
  assert.match(sql, /on o\.slug = 'module-' \|\| m\.slug \|\| '-partie-' \|\| substring\(\$2::text from '-partie-\(\[0-9\]\{1,2\}\)\$'\)/)
  assert.match(sql, /o\.slug = \$2::text/)
  assert.match(sql, /o\.type = 'module' and o\.canal = 'stripe_aok'/)
  assert.match(sql, /o\.prix_eur is not null and o\.prix_eur > 0 and o\.stripe_price_id is not null/)
  assert.match(sql, /c\.module_id <> m\.id or c\.section_id is null/, 'des sections de ce module seulement')
  const offres = r.slice(r.indexOf('export const SQL_OFFRES_DES_MODULES'), r.indexOf('/** Les sections des modules visibles'))
  assert.match(offres, /else array_agg\(c\.section_id::text order by c\.section_id::text\) end as sections/)
  assert.match(offres, /'tout', '\{\}'::text\[\]/)
  assert.match(lire('../src/lib/academie/vue-moi.ts'), /sections: o\.sections,/)
  assert.match(lire('../src/lib/academie/catalogue.ts'), /sections: Array\.isArray\(o\.sections\) \? o\.sections : \[\]/)
})

bloc('routes : la partie par son offre (jamais le module a sa place), vente PayPal fermee par defaut, email au nom de la partie', () => {
  const achat = lire('../src/app/api/academie/achat/route.ts')
  assert.match(achat, /const partie = corps\.offre === undefined \|\| corps\.offre === null \? null : offrePartie\(corps\.offre, slug\)/)
  assert.match(achat, /if \(corps\.offre !== undefined && corps\.offre !== null && !partie\) return refus\('corps', 400\)/)
  assert.match(achat, /offre = partie \? await offrePartieEnVente\(slug, partie\) : await offreEnVente\(slug\)/)
  assert.match(achat, /if \(!offre\) return refus\('module', 404\)/, 'partie absente en base : 404, rien a la vente')
  assert.doesNotMatch(achat, /corps\.(prix|montant|amount)/, 'aucun prix lu dans le corps')
  const lib = lire('../src/lib/academie/club-paypal.ts')
  const vente = lib.slice(lib.indexOf('export function ventePublique'))
  assert.match(vente, /if \(offre === 'smt-partie-1'\) return process\.env\.SMT_PARTIE_1_PAYPAL_PUBLIC\?\.trim\(\) === '1'/)
  assert.match(vente, /if \(offre === 'smt-partie-2'\) return process\.env\.SMT_PARTIE_2_PAYPAL_PUBLIC\?\.trim\(\) === '1'/)
  const mails = lire('../src/lib/mails-achat.ts')
  assert.match(mails, /const partie = p\.offreSlug && p\.offreSlug !== `module-\$\{p\.moduleSlug\}` \? p\.offreSlug : null/)
  assert.match(mails, /'select titre from public\.academie_offres where slug = \$1::text limit 1', partie/)
  assert.match(lire('../src/app/api/academie/achat/webhook/route.ts'), /offreSlug: a\.offreSlug,/)
  const capture = lire('../src/app/api/club/paypal/capturer/route.ts')
  assert.match(capture, /if \(r\.cree && offre\.module\) \{/, 'la partie suit le chemin du module')
  assert.match(capture, /slug: offre\.slug/, 'l acces pose sur l offre de la partie')
})

console.log(`\n${n} blocs ok`)
