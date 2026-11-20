// Verifie le tarif membre de la partie 2 de Smart Money Technique au Black
// Friday (20/11/2026, go de Brice : 250 EUR pour un membre du Live Club du
// 27/11 0 h au 30/11 23:59:59 heure de Paris, 850 EUR pour tous les autres),
// hors ligne, sans Stripe, PayPal ni base : le calcul du prix (membre ou non,
// juste avant, pendant et juste apres la fenetre), la session Checkout de la
// carte, la commande PayPal et sa capture, puis ce que les routes en font
// (lecture du code).
//
//   node scripts/verifier-partie2-membres-bf.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  expirationSession, lireTarif, membreDuModule, prixMembre, tarifEnCours, tarifPossible, vueTarif,
} from '../src/lib/academie/prix-membre-pur.ts'
import { preparerDroits } from '../src/lib/academie/pur.ts'
import { corpsSession, lireAchat } from '../src/lib/academie/achat-pur.ts'
import {
  OFFRES_PAYPAL, OFFRE_SMT_PARTIE_2, corpsCommande, lireCommande, montantConforme, noteAcces, offreDeReference, prixCommande,
} from '../src/lib/academie/club-paypal-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

// Le tarif tel que la base le rendra (SQL_TARIFS_MEMBRES), fenetre du brief en UTC.
const MODULE = '11111111-1111-4111-8111-111111111111'
const AUTRE_MODULE = '22222222-2222-4222-8222-222222222222'
const SECTION_P1 = '302f1748-0000-4000-8000-000000000001'
const PRIX_COURANT = 850
const ligneBF = {
  cible: OFFRE_SMT_PARTIE_2,
  slug: `${OFFRE_SMT_PARTIE_2}-membres-bf`,
  prix_eur: 250,
  stripe_price_id: 'price_BF250test',
  vente_debut: new Date('2026-11-26T23:00:00Z'),
  vente_fin: new Date('2026-11-30T22:59:59Z'),
  module_id: MODULE,
}
const BF = lireTarif(ligneBF)
const TARIFS = [BF]

// Les moments : juste avant, au debut, pendant, a la fin, juste apres.
const AVANT = new Date('2026-11-26T22:59:59Z') // jeudi 26/11 23:59:59 a Paris
const DEBUT = new Date('2026-11-26T23:00:00Z') // vendredi 27/11 0 h a Paris
const PENDANT = new Date('2026-11-28T12:00:00Z')
const FIN = new Date('2026-11-30T22:59:59Z') // lundi 30/11 23:59:59 a Paris
const APRES = new Date('2026-11-30T23:00:00Z') // mardi 01/12 0 h a Paris

// Les droits, construits par la vraie regle (preparerDroits) depuis les lignes de SQL_ACCES.
const ligneLiveClub = { origine: 'base', source: null, slug: 'live-club', ouvreTout: false, moduleId: MODULE, sectionId: SECTION_P1 }
const droits = (liveClub, lignes = [ligneLiveClub], extra = {}) =>
  preparerDroits({ admin: false, etm: false, secoursEssai: false, liveClub, lignes, ...extra })
const MEMBRE = droits('oui')
const NON_MEMBRE = droits('non')
const INCONNU = droits('inconnu')
const ACHETEUR_P1 = droits('non', [
  ligneLiveClub,
  { origine: 'acces', source: 'stripe', slug: 'module-la-formation-complete-partie-1', ouvreTout: false, moduleId: MODULE, sectionId: SECTION_P1 },
])
const EQUIPE = droits('non', [ligneLiveClub], { equipe: true })

bloc('lireTarif : la ligne de la base, et rien de ce qui est mal forme', () => {
  assert.ok(BF)
  assert.equal(BF.slug, 'module-la-formation-complete-partie-2-membres-bf')
  assert.equal(BF.prixEur, 250)
  assert.equal(BF.stripePriceId, 'price_BF250test')
  assert.equal(BF.moduleId, MODULE)
  assert.equal(lireTarif({ ...ligneBF, vente_debut: '2026-11-26T23:00:00Z', prix_eur: '250.00' })?.prixEur, 250, 'numeric et dates en texte')
  for (const mauvais of [
    { slug: 'module-la-formation-complete-partie-2-bf' }, // pas « <cible>-membres-... »
    { cible: 'module-la-formation-complete-partie-1' }, // le slug ne nomme pas la cible
    { prix_eur: 0 }, { prix_eur: null }, { prix_eur: -1 },
    { stripe_price_id: null }, { stripe_price_id: 'prod_x' },
    { vente_debut: null }, { vente_fin: 'pas une date' },
    { vente_fin: new Date('2026-11-26T23:00:00Z') }, // fin = debut
  ]) assert.equal(lireTarif({ ...ligneBF, ...mauvais }), null, JSON.stringify(mauvais))
})

bloc('fenetre : bornes comprises, en UTC (Paris = UTC+1 en novembre)', () => {
  assert.equal(tarifEnCours(BF, AVANT), false)
  assert.equal(tarifEnCours(BF, DEBUT), true)
  assert.equal(tarifEnCours(BF, PENDANT), true)
  assert.equal(tarifEnCours(BF, FIN), true)
  assert.equal(tarifEnCours(BF, APRES), false)
  assert.equal(new Date('2026-11-30T23:59:59+01:00').getTime(), FIN.getTime())
  assert.equal(new Date('2026-11-27T00:00:00+01:00').getTime(), DEBUT.getTime())
  assert.equal(tarifPossible(OFFRE_SMT_PARTIE_2, TARIFS, PENDANT), true)
  assert.equal(tarifPossible('module-la-formation-complete-partie-1', TARIFS, PENDANT), false)
  assert.equal(tarifPossible(OFFRE_SMT_PARTIE_2, TARIFS, APRES), false)
})

bloc('membre : le Live Club ouvre une partie du module ET il est actif (la regle du site)', () => {
  assert.equal(membreDuModule(MEMBRE, MODULE), true)
  assert.equal(membreDuModule(EQUIPE, MODULE), true, 'l equipe a le Live Club')
  assert.equal(membreDuModule(NON_MEMBRE, MODULE), false)
  assert.equal(membreDuModule(INCONNU, MODULE), false, 'Live Club illisible : prix courant')
  assert.equal(membreDuModule(droits('non_lu'), MODULE), false)
  assert.equal(membreDuModule(ACHETEUR_P1, MODULE), false, 'avoir achete la partie 1 ne fait pas un membre')
  assert.equal(membreDuModule(MEMBRE, AUTRE_MODULE), false, 'un autre module')
  assert.equal(membreDuModule(MEMBRE, null), false)
  assert.equal(membreDuModule(droits('oui', []), MODULE), false, 'le Live Club n ouvre rien de ce module')
})

bloc('prixMembre : membre ou non, juste avant, pendant et juste apres la fenetre', () => {
  const attendus = [
    [true, AVANT, 850], [true, DEBUT, 250], [true, PENDANT, 250], [true, FIN, 250], [true, APRES, 850],
    [false, AVANT, 850], [false, DEBUT, 850], [false, PENDANT, 850], [false, FIN, 850], [false, APRES, 850],
  ]
  for (const [membre, quand, prix] of attendus) {
    const c = prixMembre({ offre: OFFRE_SMT_PARTIE_2, prixCourantEur: PRIX_COURANT, membre, tarifs: TARIFS, quand })
    assert.equal(c.prixEur, prix, `membre=${membre} ${quand.toISOString()}`)
    assert.equal(c.prixCourantEur, 850)
    assert.equal(c.tarif === null, prix === 850)
  }
  // Jamais pour une autre offre, ni un tarif plus cher que le prix courant ; le plus bas si plusieurs.
  assert.equal(prixMembre({ offre: 'module-la-formation-complete-partie-1', prixCourantEur: 850, membre: true, tarifs: TARIFS, quand: PENDANT }).prixEur, 850)
  assert.equal(prixMembre({ offre: 'module-la-formation-complete', prixCourantEur: 1500, membre: true, tarifs: TARIFS, quand: PENDANT }).prixEur, 1500)
  assert.equal(prixMembre({ offre: OFFRE_SMT_PARTIE_2, prixCourantEur: 200, membre: true, tarifs: TARIFS, quand: PENDANT }).prixEur, 200)
  const autre = { ...BF, slug: `${OFFRE_SMT_PARTIE_2}-membres-x`, prixEur: 300 }
  assert.equal(prixMembre({ offre: OFFRE_SMT_PARTIE_2, prixCourantEur: 850, membre: true, tarifs: [autre, BF], quand: PENDANT }).tarif.slug, BF.slug)
  assert.equal(prixMembre({ offre: OFFRE_SMT_PARTIE_2, prixCourantEur: 850, membre: true, tarifs: [], quand: PENDANT }).prixEur, 850)
})

// La decision de la route carte (src/app/api/academie/achat/route.ts) : le prix calcule choisit le stripe_price_id.
const PRIX_STRIPE_COURANT = 'price_1UcKOlEAT4qWdUNVvh4OB9v6'
const offreP2 = {
  moduleSlug: 'la-formation-complete', moduleTitre: 'La Formation complete', offreSlug: OFFRE_SMT_PARTIE_2,
  stripePriceId: PRIX_STRIPE_COURANT, partie: 'Smart Money Technique, partie 2',
}
function sessionCarte(d, quand) {
  const c = prixMembre({ offre: OFFRE_SMT_PARTIE_2, prixCourantEur: PRIX_COURANT, membre: membreDuModule(d, MODULE), tarifs: TARIFS, quand })
  const o = c.tarif ? { ...offreP2, stripePriceId: c.tarif.stripePriceId, tarif: c.tarif.slug } : offreP2
  const expiresAt = c.tarif ? expirationSession(c.tarif.fin, quand) : null
  return corpsSession(o, { retourUrl: 'https://aoknowledge.com/academie/la-formation-complete?achat_session={CHECKOUT_SESSION_ID}', userId: null, email: null, essai: false, expiresAt })
}

bloc('carte : le stripe_price_id du tarif pour un membre dans la fenetre, le prix courant sinon', () => {
  for (const [d, quand, price] of [
    [MEMBRE, AVANT, PRIX_STRIPE_COURANT], [MEMBRE, DEBUT, 'price_BF250test'], [MEMBRE, PENDANT, 'price_BF250test'],
    [MEMBRE, FIN, 'price_BF250test'], [MEMBRE, APRES, PRIX_STRIPE_COURANT],
    [NON_MEMBRE, PENDANT, PRIX_STRIPE_COURANT], [INCONNU, PENDANT, PRIX_STRIPE_COURANT], [ACHETEUR_P1, PENDANT, PRIX_STRIPE_COURANT],
  ]) {
    const c = sessionCarte(d, quand)
    assert.equal(c.get('line_items[0][price]'), price, `${quand.toISOString()}`)
    // L'acces ouvert reste celui de la partie 2 (le webhook lit academie_offre).
    assert.equal(c.get('metadata[academie_offre]'), OFFRE_SMT_PARTIE_2)
    assert.equal(c.get('metadata[academie_tarif]'), price === PRIX_STRIPE_COURANT ? null : BF.slug)
    assert.equal(c.get('payment_intent_data[metadata][academie_tarif]'), price === PRIX_STRIPE_COURANT ? null : BF.slug)
    if (price === PRIX_STRIPE_COURANT) assert.equal(c.get('expires_at'), null)
  }
  // Pendant (fin a plus de 24 h) : la duree par defaut de Stripe ; le dernier jour : la fin, ou 31 min au moins.
  assert.equal(sessionCarte(MEMBRE, PENDANT).get('expires_at'), null)
  const dernierJour = new Date('2026-11-30T12:00:00Z')
  assert.equal(sessionCarte(MEMBRE, dernierJour).get('expires_at'), String(FIN.getTime() / 1000))
  const derniereMinute = new Date('2026-11-30T22:55:00Z')
  assert.equal(sessionCarte(MEMBRE, derniereMinute).get('expires_at'), String(derniereMinute.getTime() / 1000 + 31 * 60))
  assert.equal(expirationSession(FIN, new Date('2026-11-29T22:59:59Z')), null, 'exactement 24 h : rien a poser')
})

bloc('webhook : la session payee au tarif ouvre la partie 2 et garde le tarif pour la note', () => {
  const s = {
    id: 'cs_live_a1b2c3d4e5f6g7h8', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 25000,
    created: 1764500000, customer_details: { email: 'Membre@Exemple.fr' }, consent: { terms_of_service: 'accepted' },
    metadata: { source: 'academie', academie_module: 'la-formation-complete', academie_offre: OFFRE_SMT_PARTIE_2, academie_tarif: BF.slug, essai: '0' },
  }
  const lu = lireAchat(s)
  assert.equal(lu.ok, true)
  assert.equal(lu.achat.offreSlug, OFFRE_SMT_PARTIE_2)
  assert.equal(lu.achat.montantEur, 250)
  assert.equal(lu.achat.tarif, BF.slug)
  const sans = lireAchat({ ...s, metadata: { ...s.metadata, academie_tarif: undefined } })
  assert.equal('tarif' in sans.achat, false, 'une session sans tarif est lue comme avant')
})

// La route commande PayPal : le prix courant (prixCommande), puis le tarif si le compte est membre (prixDuCompte).
const p2 = OFFRES_PAYPAL['smt-partie-2']
const titulaire = { userId: '33333333-3333-4333-8333-333333333333' }
function commandePayPal(d, quand) {
  const courant = prixCommande({ offre: p2, essai: false, ligne: { prix: PRIX_COURANT } })
  assert.equal(courant.ok, true)
  const c = prixMembre({ offre: p2.slug, prixCourantEur: courant.montantEur, membre: membreDuModule(d, MODULE), tarifs: TARIFS, quand })
  return corpsCommande({ titulaire, montantEur: c.prixEur, essai: false, offre: p2, membre: c.tarif !== null })
}
// Ce que PayPal rend de la commande (GET /v2/checkout/orders/:id).
const relue = (corps, creeLe) => ({
  id: '5O190127TN364715T', status: 'APPROVED', create_time: creeLe.toISOString(),
  purchase_units: corps.purchase_units, payer: { email_address: 'membre@exemple.fr' },
})

bloc('PayPal commande : 250 et reference membre pour un membre dans la fenetre, 850 sinon', () => {
  assert.equal(p2.referenceMembre, 'module-smt-partie-2-membre')
  for (const [d, quand, montant, ref] of [
    [MEMBRE, AVANT, '850.00', 'module-smt-partie-2'], [MEMBRE, DEBUT, '250.00', 'module-smt-partie-2-membre'],
    [MEMBRE, PENDANT, '250.00', 'module-smt-partie-2-membre'], [MEMBRE, FIN, '250.00', 'module-smt-partie-2-membre'],
    [MEMBRE, APRES, '850.00', 'module-smt-partie-2'],
    [NON_MEMBRE, PENDANT, '850.00', 'module-smt-partie-2'], [INCONNU, PENDANT, '850.00', 'module-smt-partie-2'],
  ]) {
    const u = commandePayPal(d, quand).purchase_units[0]
    assert.equal(u.amount.value, montant, quand.toISOString())
    assert.equal(u.reference_id, ref)
  }
  // Jamais de reference membre en essai, ni pour une offre sans referenceMembre.
  assert.equal(corpsCommande({ titulaire, montantEur: 1, essai: true, offre: p2, membre: true }).purchase_units[0].reference_id, 'module-smt-partie-2-essai')
  const p1 = OFFRES_PAYPAL['smt-partie-1']
  assert.equal(p1.referenceMembre, undefined)
  assert.equal(corpsCommande({ titulaire, montantEur: 850, essai: false, offre: p1, membre: true }).purchase_units[0].reference_id, 'module-smt-partie-1')
  // Les references restent toutes distinctes.
  const refs = Object.values(OFFRES_PAYPAL).flatMap(o => [o.reference, o.referenceEssai, o.referenceMembre].filter(Boolean))
  assert.equal(new Set(refs).size, refs.length)
  assert.deepEqual(offreDeReference('module-smt-partie-2-membre'), { offre: p2, essai: false, membre: true })
  assert.deepEqual(offreDeReference('module-smt-partie-2'), { offre: p2, essai: false })
})

// La route capture : le montant attendu = prixMembre au moment de la CREATION de la commande, membre relu.
function captureAcceptee(commande, d) {
  if (!commande.membre) return montantConforme(commande, PRIX_COURANT)
  if (!commande.titulaire.userId || !commande.creeLe) return false
  const c = prixMembre({ offre: p2.slug, prixCourantEur: PRIX_COURANT, membre: membreDuModule(d, MODULE), tarifs: TARIFS, quand: commande.creeLe })
  return c.tarif !== null && montantConforme(commande, c.prixEur)
}

bloc('PayPal capture : la commande d un membre creee dans la fenetre passe, meme capturee apres la fin', () => {
  const corps = commandePayPal(MEMBRE, FIN)
  const lu = lireCommande(relue(corps, FIN))
  assert.equal(lu.ok, true)
  assert.equal(lu.commande.membre, true)
  assert.equal(lu.commande.offre, 'smt-partie-2')
  assert.equal(lu.commande.centimes, 25000)
  assert.equal(captureAcceptee(lu.commande, MEMBRE), true)
  // Le montant de 250 ne passe JAMAIS contre le prix courant.
  assert.equal(montantConforme(lu.commande, PRIX_COURANT), false)
  // Une commande normale reste lue comme avant (pas de cle membre).
  const normale = lireCommande(relue(commandePayPal(NON_MEMBRE, PENDANT), PENDANT))
  assert.equal('membre' in normale.commande, false)
  assert.equal(captureAcceptee(normale.commande, NON_MEMBRE), true)
  const note = noteAcces({ orderId: 'X', captureId: 'Y', centimes: 25000, essai: false, renonciationLe: FIN, payeurEmail: null, email: null, offre: 'smt-partie-2', tarif: BF.slug })
  assert.match(note, /Tarif membre module-la-formation-complete-partie-2-membres-bf/)
})

bloc('PayPal capture : refusee si la commande au tarif a ete creee hors fenetre, par un non membre ou sans compte', () => {
  // Une commande fabriquee dans le navigateur (reference membre, 250) : rien ne la prouve.
  const fabriquee = (creeLe, t = titulaire) => lireCommande(relue({
    purchase_units: [{ reference_id: 'module-smt-partie-2-membre', custom_id: t.userId ? `u:${t.userId}` : `e:${t.email}`, amount: { currency_code: 'EUR', value: '250.00' } }],
  }, creeLe)).commande
  assert.equal(captureAcceptee(fabriquee(PENDANT), MEMBRE), true, 'membre dans la fenetre : c est bien son tarif')
  assert.equal(captureAcceptee(fabriquee(APRES), MEMBRE), false, 'creee apres la fin')
  assert.equal(captureAcceptee(fabriquee(AVANT), MEMBRE), false, 'creee avant le debut')
  assert.equal(captureAcceptee(fabriquee(PENDANT), NON_MEMBRE), false, 'pas membre')
  assert.equal(captureAcceptee(fabriquee(PENDANT), INCONNU), false, 'Live Club illisible (la route rend 503, a rejouer)')
  assert.equal(captureAcceptee(fabriquee(PENDANT, { email: 'x@exemple.fr' }), MEMBRE), false, 'un email seul ne prouve pas le membre')
})

bloc('affichage (/moi) : le tarif seulement pour un membre, pendant la fenetre', () => {
  const vue = (d, quand) => vueTarif(prixMembre({ offre: OFFRE_SMT_PARTIE_2, prixCourantEur: 850, membre: membreDuModule(d, MODULE), tarifs: TARIFS, quand }))
  assert.deepEqual(vue(MEMBRE, PENDANT), { prix_eur: 250, prix_courant_eur: 850, fin_le: '2026-11-30T22:59:59.000Z' })
  assert.equal(vue(MEMBRE, AVANT), null)
  assert.equal(vue(MEMBRE, APRES), null)
  assert.equal(vue(NON_MEMBRE, PENDANT), null)
  assert.equal(vue(INCONNU, PENDANT), null)
})

bloc('code : les routes passent par prixDuCompte, le tarif n ouvre rien et ne se lit qu en base', () => {
  const carte = lire('../src/app/api/academie/achat/route.ts')
  assert.match(carte, /prixDuCompte\(\{ userId, offre: offre\.offreSlug, prixCourantEur: prixCourant, quand: maintenant \}\)/)
  assert.match(carte, /stripePriceId: calcul\.tarif\.stripePriceId, tarif: calcul\.tarif\.slug/)
  assert.doesNotMatch(carte, /corps\.prix|corps\.montant/, 'jamais un prix venu de la page')
  const commande = lire('../src/app/api/club/paypal/commande/route.ts')
  assert.match(commande, /prixDuCompte\(\{ userId, offre: offre\.slug, prixCourantEur: montantEur \}\)/)
  assert.doesNotMatch(commande, /corps\.prix|corps\.montant/)
  const capture = lire('../src/app/api/club/paypal/capturer/route.ts')
  assert.match(capture, /quand: lu\.commande\.creeLe/)
  assert.match(capture, /if \(lu\.commande\.membre\)/)
  const moi = lire('../src/app/api/academie/moi/route.ts')
  // (20/11/2026, lot des modules) /moi passe par membreDuTarif, qui rend membreDuModule pour une partie
  // (verifier-modules-membres-bf.mjs le prouve sur la partie 2).
  assert.match(moi, /membreDuTarif\(droits, o\.slug, m\.id\)/)
  const catalogue = lire('../src/app/api/academie/catalogue/route.ts')
  assert.doesNotMatch(catalogue, /tarif/i, 'le catalogue public ne montre aucun tarif')
  const sql = lire('../src/lib/academie/requetes.ts')
  const t = sql.slice(sql.indexOf('export const SQL_TARIFS_MEMBRES'), sql.indexOf('export const SQL_EMAIL_CONFIRME'))
  assert.match(t, /not exists \(select 1 from public\.academie_offre_contenus x where x\.offre_id = t\.id\)/)
  assert.match(t, /t\.slug like c\.slug \|\| '-membres-%'/)
  assert.match(t, /t\.vente_debut is not null and t\.vente_fin is not null/)
  // Le seul calcul : aucun 250 en dur dans le code.
  for (const f of ['../src/lib/academie/prix-membre-pur.ts', '../src/lib/academie/prix-membre.ts', '../src/app/api/academie/achat/route.ts',
    '../src/app/api/club/paypal/commande/route.ts', '../src/app/api/club/paypal/capturer/route.ts']) {
    const code = lire(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    assert.doesNotMatch(code, /\b250\b/, f)
  }
})

console.log(`\n${n} blocs verifies.`)
