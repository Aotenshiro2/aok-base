// Verifie, hors ligne, sans Stripe ni base (27-28/11/2026) :
// 1. qui a le tarif membre (membreDuTarif) : Live Club actif, formation longue
//    achetee, ETM actuel ou ancien ; pas un visiteur ni un acheteur de la
//    partie 1 seule ; module entier et partie de module ;
// 2. la vente d'une PARTIE reservee aux membres du Live Club (ventePartie) ;
// 3. BF26 au paiement Stripe Checkout (code-promo-pur.ts) : applique
//    (discounts) pour un non-membre dans la fenetre, ni remise ni champ pour un
//    tarif membre ou un soutien, rien apres la fenetre ; corpsSession et
//    corpsSessionAbonnement ne posent jamais discounts et allow_promotion_codes
//    ensemble ;
// 4. le cablage des routes (lecture du code).
//
//   node scripts/verifier-prix-membre-profils.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ERREUR_PARTIE_RESERVEE, estOffreDePartie, lireTarif, membreDuModule, membreDuTarif, membreHorsLiveClub, prixMembre, ventePartie,
} from '../src/lib/academie/prix-membre-pur.ts'
import { OFFRE_FORMATION_LONGUE, preparerDroits } from '../src/lib/academie/pur.ts'
import { corpsSession } from '../src/lib/academie/achat-pur.ts'
import { corpsSessionAbonnement } from '../src/lib/pilotage-paliers.ts'
import {
  CODE_PROMO_JUSQUA, PROMO_BF26, champCodePromo, libelleRemise, promoBf26, remiseCheckout, sansRemiseAppliquee,
} from '../src/lib/code-promo-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const SMT = '11111111-1111-4111-8111-111111111111'
const SECTION_P1 = '302f1748-0000-4000-8000-000000000001'
const JOURNALING = 'aaaaaaaa-0000-4000-8000-000000000003'
const P1 = 'module-la-formation-complete-partie-1'
const P2 = 'module-la-formation-complete-partie-2'
const MODULE = 'module-journaling'

const ligneLiveClub = { origine: 'base', source: null, slug: 'live-club', ouvreTout: false, moduleId: SMT, sectionId: SECTION_P1 }
const achatP1 = { origine: 'acces', source: 'stripe', slug: P1, ouvreTout: false, moduleId: SMT, sectionId: SECTION_P1 }
const achatFormation = (source, ouvreTout = true) => ({ origine: 'acces', source, slug: OFFRE_FORMATION_LONGUE, ouvreTout, moduleId: null, sectionId: null })
const droits = (liveClub, lignes = [ligneLiveClub], extra = {}) =>
  preparerDroits({ admin: false, etm: false, secoursEssai: false, liveClub, lignes, ...extra })

// Les profils du brief.
const PROFILS = {
  liveClubSeul: droits('oui'),
  formationParAcces: droits('non', [ligneLiveClub, achatFormation('paypal')]),
  formationParFiche: droits('non', [ligneLiveClub], { formationLongue: true }),
  formationSkool: droits('non', [ligneLiveClub, achatFormation('migration_skool')]),
  etmActuel: droits('non_lu', [ligneLiveClub], { etm: true }),
  ancienEtm: droits('non', [ligneLiveClub], { aEteEtm: true }),
  ancienEtmLiveClubInconnu: droits('inconnu', [ligneLiveClub], { aEteEtm: true }),
  partie1Seule: droits('non', [ligneLiveClub, achatP1]),
  visiteur: droits('non_lu'),
  liveClubInconnu: droits('inconnu'),
}
const MEMBRES = ['liveClubSeul', 'formationParAcces', 'formationParFiche', 'formationSkool', 'etmActuel', 'ancienEtm', 'ancienEtmLiveClubInconnu']
const NON_MEMBRES = ['partie1Seule', 'visiteur', 'liveClubInconnu']

bloc('preparerDroits : formation longue et ETM ancien lus, sans rien ouvrir de plus', () => {
  assert.equal(PROFILS.formationParAcces.formationLongue, true)
  assert.equal(PROFILS.formationParFiche.formationLongue, true)
  assert.equal(PROFILS.formationSkool.formationLongue, true)
  assert.equal(PROFILS.partie1Seule.formationLongue, false, 'la partie 1 n est pas la formation longue')
  assert.equal(PROFILS.etmActuel.aEteEtm, true, 'un ETM actuel a ete ETM')
  assert.equal(PROFILS.ancienEtm.aEteEtm, true)
  assert.equal(PROFILS.ancienEtm.etm, false, 'le sens de etm ne change pas : un ancien ETM n ouvre pas tout')
  assert.equal(PROFILS.ancienEtm.ouvertures.some(o => o.raison === 'etm'), false)
  assert.deepEqual(PROFILS.formationParFiche.ouvertures, PROFILS.visiteur.ouvertures, 'le fait du cockpit n ouvre rien')
  assert.equal(PROFILS.visiteur.formationLongue, false)
  assert.equal(PROFILS.visiteur.aEteEtm, false)
  // Une source inconnue (ni stripe, ni paypal, ni skool, ni offert, ni liveclub) ne compte pas.
  assert.equal(droits('non', [achatFormation('autre')]).formationLongue, false)
})

bloc('membreDuTarif, module entier : Live Club, formation longue, ETM actuel ou ancien ; pas les autres', () => {
  for (const p of MEMBRES) assert.equal(membreDuTarif(PROFILS[p], MODULE, JOURNALING), true, p)
  for (const p of NON_MEMBRES) assert.equal(membreDuTarif(PROFILS[p], MODULE, JOURNALING), false, p)
  assert.equal(membreHorsLiveClub({}), false, 'champs absents : faux')
  // Droits construits a la main sans les nouveaux champs : la regle d avant.
  assert.equal(membreDuTarif({ liveClub: 'oui', ouvertures: [] }, MODULE, null), true)
  assert.equal(membreDuTarif({ liveClub: 'non', ouvertures: [] }, MODULE, null), false)
})

bloc('membreDuTarif, partie de module : la regle du Live Club, plus formation longue ou ETM', () => {
  for (const offre of [P1, P2]) {
    assert.equal(membreDuTarif(PROFILS.liveClubSeul, offre, SMT), membreDuModule(PROFILS.liveClubSeul, SMT), 'Live Club : inchange')
    assert.equal(membreDuTarif(PROFILS.liveClubSeul, offre, SMT), true)
    for (const p of ['formationParAcces', 'formationParFiche', 'etmActuel', 'ancienEtm']) assert.equal(membreDuTarif(PROFILS[p], offre, SMT), true, p)
    assert.equal(membreDuTarif(PROFILS.partie1Seule, offre, SMT), false, 'un achat de la partie 1 seule ne fait pas un membre')
    assert.equal(membreDuTarif(PROFILS.visiteur, offre, SMT), false)
    assert.equal(membreDuTarif(droits('oui', []), offre, SMT), false, 'Live Club qui n ouvre rien du module : regle d avant')
  }
})

// Un tarif de la partie 2 et d'un module dans la fenetre du Black Friday.
const tarif = (cible, prix, price, moduleId) => lireTarif({
  cible, slug: `${cible}-membres-bf`, prix_eur: prix, stripe_price_id: price,
  vente_debut: new Date('2026-11-26T23:00:00Z'), vente_fin: new Date('2026-11-30T22:59:59Z'), module_id: moduleId,
})
const TARIFS = [tarif(P2, 250, 'price_BF250test', SMT), tarif(MODULE, 25, 'price_JOURtest', JOURNALING)]
const PENDANT = new Date('2026-11-28T12:00:00Z')

bloc('prixMembre : le meme prix pour l affichage (/moi) et la facturation (carte, PayPal)', () => {
  for (const p of MEMBRES) {
    assert.equal(prixMembre({ offre: MODULE, prixCourantEur: 49, membre: membreDuTarif(PROFILS[p], MODULE, JOURNALING), tarifs: TARIFS, quand: PENDANT }).prixEur, 25, p)
  }
  for (const p of NON_MEMBRES) {
    assert.equal(prixMembre({ offre: MODULE, prixCourantEur: 49, membre: membreDuTarif(PROFILS[p], MODULE, JOURNALING), tarifs: TARIFS, quand: PENDANT }).prixEur, 49, p)
  }
  assert.equal(prixMembre({ offre: P2, prixCourantEur: 850, membre: membreDuTarif(PROFILS.ancienEtm, P2, SMT), tarifs: TARIFS, quand: PENDANT }).prixEur, 250)
  assert.equal(prixMembre({ offre: P2, prixCourantEur: 850, membre: membreDuTarif(PROFILS.partie1Seule, P2, SMT), tarifs: TARIFS, quand: PENDANT }).prixEur, 850)
})

bloc('ventePartie : une partie seulement pour un compte membre du Live Club', () => {
  assert.equal(estOffreDePartie(P1), true)
  assert.equal(estOffreDePartie(P2), true)
  assert.equal(estOffreDePartie('module-la-formation-complete'), false)
  assert.equal(ERREUR_PARTIE_RESERVEE, 'partie_reservee_membres')
  for (const offre of [P1, P2]) {
    assert.equal(ventePartie({ offre, connecte: false, liveClub: null }), 'reservee', 'pas de compte')
    assert.equal(ventePartie({ offre, connecte: true, liveClub: 'oui' }), 'ok')
    assert.equal(ventePartie({ offre, connecte: true, liveClub: 'non' }), 'reservee')
    assert.equal(ventePartie({ offre, connecte: true, liveClub: 'non_lu' }), 'reservee')
    assert.equal(ventePartie({ offre, connecte: true, liveClub: 'inconnu' }), 'inconnu')
    for (const p of ['formationParFiche', 'ancienEtm', 'partie1Seule']) {
      assert.equal(ventePartie({ offre, connecte: true, liveClub: PROFILS[p].liveClub }), 'reservee', `${p} : formation ou ETM seuls n ouvrent pas la partie`)
    }
    // L'equipe a toujours le Live Club.
    assert.equal(ventePartie({ offre, connecte: true, liveClub: droits('non', [ligneLiveClub], { equipe: true }).liveClub }), 'ok')
  }
  for (const offre of ['module-la-formation-complete', MODULE, 'formation-complete', 'coaching-8h']) {
    assert.equal(ventePartie({ offre, connecte: false, liveClub: null }), 'ok', `${offre} : a tous`)
  }
})

const AVANT_FIN = new Date('2026-11-30T22:59:59Z') // lundi 30/11 23:59:59 a Paris
const APRES = new Date('2026-11-30T23:00:00Z') // mardi 01/12 0 h a Paris

bloc('BF26 : la fenetre, l id et les cas sans remise', () => {
  assert.equal(CODE_PROMO_JUSQUA.getTime() / 1000, 1796079600, 'fin exclusive = expiration du code (1796079599) + 1 s')
  assert.match(PROMO_BF26, /^promo_[A-Za-z0-9]+$/)
  assert.equal(promoBf26({}), PROMO_BF26)
  assert.equal(promoBf26({ STRIPE_PROMO_BF26: 'promo_Autre123' }), 'promo_Autre123')
  assert.equal(promoBf26({ STRIPE_PROMO_BF26: 'aucun' }), null, 'coupure : champ seul')
  assert.equal(promoBf26({ STRIPE_PROMO_BF26: 'n importe quoi' }), PROMO_BF26)
  assert.deepEqual(remiseCheckout({ quand: PENDANT, prixMembre: false, promo: PROMO_BF26 }), { promotionCode: PROMO_BF26 })
  assert.deepEqual(remiseCheckout({ quand: AVANT_FIN, prixMembre: false, promo: PROMO_BF26 }), { promotionCode: PROMO_BF26 })
  assert.deepEqual(remiseCheckout({ quand: PENDANT, prixMembre: false, promo: null }), { champ: true }, 'sans id : le champ')
  assert.equal(remiseCheckout({ quand: APRES, prixMembre: false, promo: PROMO_BF26 }), null, 'apres la fenetre : rien')
  assert.equal(remiseCheckout({ quand: PENDANT, prixMembre: true, promo: PROMO_BF26 }), null, 'tarif membre : ni remise ni champ')
  assert.equal(remiseCheckout({ quand: PENDANT, prixMembre: false, soutien: true, promo: PROMO_BF26 }), null, 'soutien : rien')
  assert.equal(remiseCheckout({ quand: PENDANT, prixMembre: false, compris: true, promo: PROMO_BF26 }), null, 'app incluse : rien')
  assert.equal(champCodePromo({ quand: new Date(NaN), prixMembre: false }), false)
  assert.deepEqual(sansRemiseAppliquee({ promotionCode: PROMO_BF26 }), { champ: true })
  assert.equal(sansRemiseAppliquee(null), null)
  assert.equal(libelleRemise(null), '')
})

const offreModule = { moduleSlug: 'journaling', moduleTitre: 'Journaling', offreSlug: MODULE, stripePriceId: 'price_COURANTtest' }
const session = (o, remise) => corpsSession(o, {
  retourUrl: 'https://aoknowledge.com/academie/journaling?achat_session={CHECKOUT_SESSION_ID}', userId: null, email: null, essai: false, remise,
})

bloc('corpsSession (module) : non-membre dans la fenetre = discounts BF26 ; membre = rien ; apres = rien', () => {
  // Non-membre (ou visiteur) dans la fenetre : le prix courant, BF26 applique.
  const nonMembre = session(offreModule, remiseCheckout({ quand: PENDANT, prixMembre: false, promo: PROMO_BF26 }))
  assert.equal(nonMembre.get('discounts[0][promotion_code]'), PROMO_BF26)
  assert.equal(nonMembre.get('allow_promotion_codes'), null, 'jamais les deux')
  assert.equal(nonMembre.get('line_items[0][price]'), 'price_COURANTtest')
  // Membre : le tarif, ni remise ni champ, meme si on en demandait une.
  const membre = { ...offreModule, stripePriceId: 'price_JOURtest', tarif: `${MODULE}-membres-bf` }
  for (const r of [remiseCheckout({ quand: PENDANT, prixMembre: true, promo: PROMO_BF26 }), { promotionCode: PROMO_BF26 }, { champ: true }]) {
    const s = session(membre, r)
    assert.equal(s.get('discounts[0][promotion_code]'), null)
    assert.equal(s.get('allow_promotion_codes'), null)
  }
  // Apres la fenetre : rien.
  const apres = session(offreModule, remiseCheckout({ quand: APRES, prixMembre: false, promo: PROMO_BF26 }))
  assert.equal(apres.get('discounts[0][promotion_code]'), null)
  assert.equal(apres.get('allow_promotion_codes'), null)
  // Sans id : le champ seul.
  const champ = session(offreModule, { champ: true })
  assert.equal(champ.get('allow_promotion_codes'), 'true')
  assert.equal(champ.get('discounts[0][promotion_code]'), null)
  // Sans remise passee : comme avant.
  assert.equal(session(offreModule, undefined).get('allow_promotion_codes'), null)
})

bloc('corpsSessionAbonnement (Pilotage, Duo) : BF26 applique hors soutien, rien en soutien', () => {
  const base = { prix: 'price_PILtest', retourUrl: 'https://pilotage.aoknowledge.com/offres?session_id={CHECKOUT_SESSION_ID}', userId: null, email: null, essai: false }
  for (const slug of ['pilotage-premium-mensuel', 'pilotage-premium-annuel', 'premium-duo-mensuel', 'premium-duo-annuel']) {
    const s = corpsSessionAbonnement({ ...base, slug, remise: remiseCheckout({ quand: PENDANT, prixMembre: false, promo: PROMO_BF26 }) })
    assert.equal(s.get('mode'), 'subscription')
    assert.equal(s.get('discounts[0][promotion_code]'), PROMO_BF26, slug)
    assert.equal(s.get('allow_promotion_codes'), null)
    const apres = corpsSessionAbonnement({ ...base, slug, remise: remiseCheckout({ quand: APRES, prixMembre: false, promo: PROMO_BF26 }) })
    assert.equal(apres.get('discounts[0][promotion_code]'), null)
    assert.equal(apres.get('allow_promotion_codes'), null)
  }
  const soutien = corpsSessionAbonnement({ ...base, slug: 'pilotage-premium-mensuel', soutien: true, remise: { promotionCode: PROMO_BF26 } })
  assert.equal(soutien.get('discounts[0][promotion_code]'), null, 'soutien : jamais de remise, meme demandee')
  assert.equal(soutien.get('allow_promotion_codes'), null)
})

bloc('code : les routes passent par remiseCheckout, ventePartie et les faits du cockpit', () => {
  const carte = lire('../src/app/api/academie/achat/route.ts')
  assert.match(carte, /remiseCheckout\(\{ quand: new Date\(\), prixMembre: Boolean\(offre\.tarif\), promo: promoBf26\(process\.env\) \}\)/)
  assert.match(carte, /ventePartieDuCompte\(userId, offre\.offreSlug\)/)
  assert.ok(carte.indexOf('ventePartieDuCompte(') < carte.indexOf('prixDuCompte({'), 'la partie est refusee avant le prix')
  const pil = lire('../src/app/api/pilotage/achat/route.ts')
  assert.match(pil, /remiseCheckout\(\{ quand: new Date\(\), prixMembre: false, soutien, compris, promo: promoBf26\(process\.env\) \}\)/)
  const paypal = lire('../src/app/api/club/paypal/commande/route.ts')
  assert.match(paypal, /ventePartieDuCompte\(userId, offre\.slug\)/)
  assert.doesNotMatch(paypal, /promoBf26|remiseCheckout|PROMO_BF26/, 'PayPal : jamais BF26')
  const achat = lire('../src/lib/academie/achat.ts')
  assert.match(achat, /err\.statut !== 400/, 'repli sur le champ seul si Stripe refuse la remise')
  const sql = lire('../src/lib/academie/requetes.ts')
  const faits = sql.slice(sql.indexOf('export const SQL_FAITS_COCKPIT'), sql.indexOf('export const SQL_ACCES'))
  const etm = faits.slice(0, faits.indexOf(') as etm,'))
  assert.match(etm, /s\.retire_le is null/, 'etm garde son sens')
  const aEte = faits.slice(faits.indexOf(') as etm,'), faits.indexOf(') as a_ete_etm,'))
  assert.doesNotMatch(aEte, /retire_le/, 'a_ete_etm : retire ou non')
  const formation = faits.slice(faits.indexOf(') as a_ete_etm,'), faits.indexOf(') as formation_longue,'))
  assert.match(formation, /o\.slug = 'formation-complete' and a\.retire_le is null/)
  assert.match(formation, /cockpit_membre_emails/, 'par les emails de la fiche du cockpit aussi')
  const dr = lire('../src/lib/academie/droits.ts')
  assert.match(dr, /aEteEtm: c\?\.a_ete_etm === true/)
  assert.match(dr, /formationLongue: c\?\.formation_longue === true/)
})

console.log(`\n${n} blocs verifies.`)
