// Verifie le tarif membre des 7 modules vendus a l'unite au Black Friday
// (20/11/2026, brief de l'Orchestre Prix sur le oui de Brice : moitie prix,
// arrondi, pour un membre du Live Club actif, du 27/11 0 h au 30/11 23:59:59
// heure de Paris ; prix courant pour tous les autres), hors ligne, sans
// Stripe ni base : qui y a droit (membreDuTarif), le prix (membre ou non,
// juste avant, pendant et juste apres la fenetre), la session Checkout de la
// carte, le webhook, /moi, puis ce que les routes en font (lecture du code).
// La partie 2 de Smart Money Technique garde sa regle : verifie ici aussi.
//
//   node scripts/verifier-modules-membres-bf.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  expirationSession, lireTarif, membreDuModule, membreDuTarif, prixMembre, tarifPossible, vueTarif,
} from '../src/lib/academie/prix-membre-pur.ts'
import { preparerDroits } from '../src/lib/academie/pur.ts'
import { corpsSession, lireAchat } from '../src/lib/academie/achat-pur.ts'
import { OFFRE_SMT_PARTIE_2 } from '../src/lib/academie/club-paypal-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

// Les 7 offres du brief : prix courant, prix membre au Black Friday (le tableau du brief, tel quel).
const MODULES = [
  ['module-rediffusion-des-lives', 19, 10],
  ['module-plan-de-trading-21-jours', 39, 19],
  ['module-journaling', 49, 25],
  ['module-psychologie-et-emotions', 49, 25],
  ['module-chroniques-de-l-accelerateur', 79, 39],
  ['module-serenite-financiere', 99, 49],
  ['module-macros-les-archives-privees', 399, 199],
].map(([offre, courant, membre], i) => ({
  offre, courant, membre, moduleId: `aaaaaaaa-0000-4000-8000-00000000000${i + 1}`, price: `price_MOD${i + 1}test`,
}))

// Les moments : juste avant, au debut, pendant, a la fin, juste apres (la fenetre de la partie 2, en UTC).
const DEBUT_UTC = '2026-11-26T23:00:00Z'
const FIN_UTC = '2026-11-30T22:59:59Z'
const AVANT = new Date('2026-11-26T22:59:59Z') // jeudi 26/11 23:59:59 a Paris
const DEBUT = new Date(DEBUT_UTC) // vendredi 27/11 0 h a Paris
const PENDANT = new Date('2026-11-28T12:00:00Z')
const FIN = new Date(FIN_UTC) // lundi 30/11 23:59:59 a Paris
const APRES = new Date('2026-11-30T23:00:00Z') // mardi 01/12 0 h a Paris

// Les tarifs tels que la base les rendra (SQL_TARIFS_MEMBRES), plus celui de la partie 2, deja en ligne.
const SMT = '11111111-1111-4111-8111-111111111111'
const SECTION_P1 = '302f1748-0000-4000-8000-000000000001'
const ligne = (m) => ({
  cible: m.offre, slug: `${m.offre}-membres-bf`, prix_eur: m.membre, stripe_price_id: m.price,
  vente_debut: new Date(DEBUT_UTC), vente_fin: new Date(FIN_UTC), module_id: m.moduleId,
})
const P2 = lireTarif({
  cible: OFFRE_SMT_PARTIE_2, slug: `${OFFRE_SMT_PARTIE_2}-membres-bf`, prix_eur: 250, stripe_price_id: 'price_BF250test',
  vente_debut: new Date(DEBUT_UTC), vente_fin: new Date(FIN_UTC), module_id: SMT,
})
const TARIFS = [...MODULES.map(m => lireTarif(ligne(m))), P2]

// Les droits, construits par la vraie regle (preparerDroits) depuis les lignes de SQL_ACCES. Le Live Club
// (offre live-club de la base) ouvre la partie 1 de Smart Money Technique, comme aujourd'hui.
const ligneLiveClub = { origine: 'base', source: null, slug: 'live-club', ouvreTout: false, moduleId: SMT, sectionId: SECTION_P1 }
const achatModule = (m) => ({ origine: 'acces', source: 'stripe', slug: m.offre, ouvreTout: false, moduleId: m.moduleId, sectionId: null })
const droits = (liveClub, lignes = [ligneLiveClub], extra = {}) =>
  preparerDroits({ admin: false, etm: false, secoursEssai: false, liveClub, lignes, ...extra })
const MEMBRE = droits('oui')
const NON_MEMBRE = droits('non')
const INCONNU = droits('inconnu')
const NON_LU = droits('non_lu')
const EQUIPE = droits('non', [ligneLiveClub], { equipe: true })
// Live Club actif, mais l'offre live-club n'ouvre rien de Smart Money Technique : membre pour les modules, PAS pour la partie 2.
const MEMBRE_SANS_P1 = droits('oui', [])
// Non membre qui a achete un module : l'achat ne fait pas un membre.
const ACHETEUR = droits('non', [ligneLiveClub, ...MODULES.map(achatModule)])

/** Ce que prixDuCompte (prix-membre.ts) calcule, sans la base : la regle du tarif, puis prixMembre. */
const calcul = (d, offre, courant, moduleId, quand) =>
  prixMembre({ offre, prixCourantEur: courant, membre: membreDuTarif(d, offre, moduleId), tarifs: TARIFS, quand })

bloc('lireTarif : les 7 lignes de la base se lisent, au prix du brief', () => {
  for (const m of MODULES) {
    const t = TARIFS.find(x => x.cible === m.offre)
    assert.ok(t, m.offre)
    assert.equal(t.slug, `${m.offre}-membres-bf`)
    assert.equal(t.prixEur, m.membre)
    assert.equal(t.stripePriceId, m.price)
    assert.equal(t.moduleId, m.moduleId)
    assert.ok(t.prixEur < m.courant)
    assert.ok(Math.abs(t.prixEur - m.courant / 2) <= 0.5, `${m.offre} : la moitie, arrondie (tableau du brief)`)
  }
  assert.equal(TARIFS.length, 8)
})

bloc('qui y a droit : un module entier demande le Live Club actif, seulement', () => {
  for (const m of MODULES) {
    assert.equal(membreDuTarif(MEMBRE, m.offre, m.moduleId), true, m.offre)
    assert.equal(membreDuTarif(MEMBRE_SANS_P1, m.offre, m.moduleId), true, 'le Live Club n a pas a ouvrir ce module')
    assert.equal(membreDuTarif(EQUIPE, m.offre, m.moduleId), true, 'l equipe a le Live Club')
    assert.equal(membreDuTarif(NON_MEMBRE, m.offre, m.moduleId), false)
    assert.equal(membreDuTarif(INCONNU, m.offre, m.moduleId), false, 'Live Club illisible : non membre')
    assert.equal(membreDuTarif(NON_LU, m.offre, m.moduleId), false)
    assert.equal(membreDuTarif(ACHETEUR, m.offre, m.moduleId), false, 'avoir achete un module ne fait pas un membre')
    assert.equal(membreDuTarif(MEMBRE, m.offre, null), true, 'module_id absent : la regle ne le lit pas')
  }
})

bloc('partie 2 : EXACTEMENT la regle d avant (membreDuModule), pour tous les comptes', () => {
  const comptes = { MEMBRE, NON_MEMBRE, INCONNU, NON_LU, EQUIPE, MEMBRE_SANS_P1, ACHETEUR }
  for (const [nom, d] of Object.entries(comptes)) {
    for (const mod of [SMT, MODULES[0].moduleId, null]) {
      assert.equal(membreDuTarif(d, OFFRE_SMT_PARTIE_2, mod), membreDuModule(d, mod), `${nom} ${mod}`)
      assert.equal(membreDuTarif(d, 'module-la-formation-complete-partie-1', mod), membreDuModule(d, mod), `${nom} partie 1`)
    }
  }
  assert.equal(membreDuTarif(MEMBRE_SANS_P1, OFFRE_SMT_PARTIE_2, SMT), false, 'Live Club actif qui n ouvre rien du module : pas membre pour la partie 2')
  for (const [d, quand, prix] of [
    [MEMBRE, AVANT, 850], [MEMBRE, DEBUT, 250], [MEMBRE, PENDANT, 250], [MEMBRE, FIN, 250], [MEMBRE, APRES, 850],
    [MEMBRE_SANS_P1, PENDANT, 850], [NON_MEMBRE, PENDANT, 850], [INCONNU, PENDANT, 850], [EQUIPE, PENDANT, 250],
  ]) assert.equal(calcul(d, OFFRE_SMT_PARTIE_2, 850, SMT, quand).prixEur, prix, `${quand.toISOString()}`)
})

bloc('prix des 7 modules : membre ou non, juste avant, pendant et juste apres la fenetre', () => {
  for (const m of MODULES) {
    for (const [d, quand, attendu] of [
      [MEMBRE, AVANT, m.courant], [MEMBRE, DEBUT, m.membre], [MEMBRE, PENDANT, m.membre], [MEMBRE, FIN, m.membre], [MEMBRE, APRES, m.courant],
      [MEMBRE_SANS_P1, PENDANT, m.membre], [EQUIPE, PENDANT, m.membre],
      [NON_MEMBRE, AVANT, m.courant], [NON_MEMBRE, DEBUT, m.courant], [NON_MEMBRE, PENDANT, m.courant], [NON_MEMBRE, FIN, m.courant], [NON_MEMBRE, APRES, m.courant],
      [INCONNU, PENDANT, m.courant], [NON_LU, PENDANT, m.courant], [ACHETEUR, PENDANT, m.courant],
    ]) {
      const c = calcul(d, m.offre, m.courant, m.moduleId, quand)
      assert.equal(c.prixEur, attendu, `${m.offre} ${quand.toISOString()}`)
      assert.equal(c.prixCourantEur, m.courant)
      assert.equal(c.tarif === null, attendu === m.courant)
      if (c.tarif) assert.equal(c.tarif.stripePriceId, m.price, 'le prix Stripe du tarif de CE module')
    }
    assert.equal(tarifPossible(m.offre, TARIFS, AVANT), false)
    assert.equal(tarifPossible(m.offre, TARIFS, PENDANT), true)
    assert.equal(tarifPossible(m.offre, TARIFS, APRES), false)
  }
})

bloc('hors du lot : Smart Money Technique entier et partie 1 au prix courant, meme pour un membre', () => {
  for (const d of [MEMBRE, EQUIPE, MEMBRE_SANS_P1]) {
    assert.equal(calcul(d, 'module-la-formation-complete', 1500, SMT, PENDANT).prixEur, 1500)
    assert.equal(calcul(d, 'module-la-formation-complete-partie-1', 850, SMT, PENDANT).prixEur, 850)
    assert.equal(calcul(d, 'module-l-appat-du-grand-public', 49, null, PENDANT).prixEur, 49)
  }
  // Le tarif d'un module ne vaut jamais pour un autre (cible exacte).
  assert.equal(prixMembre({ offre: 'module-journaling', prixCourantEur: 49, membre: true, tarifs: TARIFS.filter(t => t.cible !== 'module-journaling'), quand: PENDANT }).prixEur, 49)
})

// La decision de la route carte (src/app/api/academie/achat/route.ts) pour un module entier : pas de partie.
const PRIX_STRIPE_COURANT = 'price_COURANTtest'
function sessionCarte(m, d, quand) {
  const offre = { moduleSlug: m.offre.replace(/^module-/, ''), moduleTitre: 'Titre', offreSlug: m.offre, stripePriceId: PRIX_STRIPE_COURANT }
  const c = calcul(d, m.offre, m.courant, m.moduleId, quand)
  const o = c.tarif ? { ...offre, stripePriceId: c.tarif.stripePriceId, tarif: c.tarif.slug } : offre
  const expiresAt = c.tarif ? expirationSession(c.tarif.fin, quand) : null
  return corpsSession(o, { retourUrl: `https://aoknowledge.com/academie/${offre.moduleSlug}?achat_session={CHECKOUT_SESSION_ID}`, userId: null, email: null, essai: false, expiresAt })
}

bloc('carte : le stripe_price_id du tarif du module pour un membre dans la fenetre, le prix courant sinon', () => {
  for (const m of MODULES) {
    for (const [d, quand, price] of [
      [MEMBRE, AVANT, PRIX_STRIPE_COURANT], [MEMBRE, DEBUT, m.price], [MEMBRE, PENDANT, m.price], [MEMBRE, FIN, m.price],
      [MEMBRE, APRES, PRIX_STRIPE_COURANT], [NON_MEMBRE, PENDANT, PRIX_STRIPE_COURANT], [INCONNU, PENDANT, PRIX_STRIPE_COURANT],
    ]) {
      const c = sessionCarte(m, d, quand)
      assert.equal(c.get('line_items[0][price]'), price, `${m.offre} ${quand.toISOString()}`)
      assert.equal(c.get('metadata[academie_offre]'), m.offre, 'l acces ouvert reste celui du module')
      assert.equal(c.get('metadata[academie_tarif]'), price === PRIX_STRIPE_COURANT ? null : `${m.offre}-membres-bf`)
      if (price === PRIX_STRIPE_COURANT) assert.equal(c.get('expires_at'), null)
    }
    assert.equal(sessionCarte(m, MEMBRE, new Date('2026-11-30T12:00:00Z')).get('expires_at'), String(FIN.getTime() / 1000))
  }
})

bloc('webhook : la session payee au tarif ouvre le module et garde le tarif pour la note', () => {
  const m = MODULES[2]
  const s = {
    id: 'cs_live_z9y8x7w6v5u4t3s2', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: m.membre * 100,
    created: 1764500000, customer_details: { email: 'Membre@Exemple.fr' }, consent: { terms_of_service: 'accepted' },
    metadata: { source: 'academie', academie_module: 'journaling', academie_offre: m.offre, academie_tarif: `${m.offre}-membres-bf`, essai: '0' },
  }
  const lu = lireAchat(s)
  assert.equal(lu.ok, true)
  assert.equal(lu.achat.offreSlug, m.offre)
  assert.equal(lu.achat.montantEur, m.membre)
  assert.equal(lu.achat.tarif, `${m.offre}-membres-bf`)
})

bloc('affichage (/moi) : le tarif du module seulement pour un membre, pendant la fenetre', () => {
  for (const m of MODULES) {
    const vue = (d, quand) => vueTarif(calcul(d, m.offre, m.courant, m.moduleId, quand))
    assert.deepEqual(vue(MEMBRE, PENDANT), { prix_eur: m.membre, prix_courant_eur: m.courant, fin_le: '2026-11-30T22:59:59.000Z' })
    assert.deepEqual(vue(MEMBRE, FIN), { prix_eur: m.membre, prix_courant_eur: m.courant, fin_le: '2026-11-30T22:59:59.000Z' })
    assert.equal(vue(MEMBRE, AVANT), null)
    assert.equal(vue(MEMBRE, APRES), null)
    assert.equal(vue(NON_MEMBRE, PENDANT), null)
    assert.equal(vue(INCONNU, PENDANT), null)
  }
})

bloc('code : la carte vend aussi le module entier au tarif, /moi et prixDuCompte passent par membreDuTarif', () => {
  const carte = lire('../src/app/api/academie/achat/route.ts')
  assert.match(carte, /if \(userId && prixCourant !== null && prixCourant > 0\) \{/, 'plus de condition « partie »')
  // (28/11/2026) Les droits deja lus pour une partie (ventePartieDuCompte) sont passes, sinon prixDuCompte les lit.
  assert.match(carte, /prixDuCompte\(\{ userId, offre: offre\.offreSlug, prixCourantEur: prixCourant, quand: maintenant, droits: vente\.droits \?\? undefined \}\)/)
  assert.doesNotMatch(carte, /corps\.prix|corps\.montant/, 'jamais un prix venu de la page')
  const achat = lire('../src/lib/academie/achat.ts')
  const ov = achat.slice(achat.indexOf('export async function offreEnVente'), achat.indexOf('export async function offrePartieEnVente'))
  assert.match(ov, /prixEur: Number\(l\.prix_eur\)/)
  const sql = lire('../src/lib/academie/requetes.ts')
  const s = sql.slice(sql.indexOf('export const SQL_OFFRE_EN_VENTE'), sql.indexOf('export const SQL_OFFRE_PARTIE_EN_VENTE'))
  assert.match(s, /o\.prix_eur::float8 as prix_eur/)
  assert.match(lire('../src/lib/academie/prix-membre.ts'), /membre: membreDuTarif\(droits, p\.offre, moduleId\)/)
  assert.match(lire('../src/app/api/academie/moi/route.ts'), /membre: membreDuTarif\(droits, o\.slug, m\.id\)/)
  // PayPal : jamais de tarif pour un module entier (seule la partie 2 a une referenceMembre).
  assert.match(lire('../src/app/api/club/paypal/commande/route.ts'), /if \(!essai && offre\.referenceMembre && userId\)/)
  // Aucun prix membre en dur.
  for (const f of ['../src/lib/academie/prix-membre-pur.ts', '../src/lib/academie/prix-membre.ts', '../src/app/api/academie/achat/route.ts']) {
    const code = lire(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    for (const m of MODULES) assert.doesNotMatch(code, new RegExp(`\\b${m.membre}\\b`), `${f} : ${m.membre}`)
  }
})

console.log(`\n${n} blocs verifies.`)
