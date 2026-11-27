// Verification du correctif des bonus membres du Live Club (27/11/2026) :
// - le Live Club d'un compte par TOUS ses emails connus (liveclub/compte-pur.ts) ;
// - le Carnet et Pilotage Premium : la vue du cockpit OU le direct ;
// - les prix membres du Black Friday : plus de prix plein en silence ;
// - le cablage (entitlements, academie/droits, droitLiveClub, routes d'achat).
// Cas : trialing sans charge, ancien mensuel annule et nouveau forfait actif,
// forfait sous un autre email de la meme fiche, Stripe en delai depasse,
// broker, ETM. Aucune base, aucun reseau.
// node scripts/verifier-bonus-membres.mjs

import './resoudre-ts.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const C = await import('../src/lib/liveclub/compte-pur.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const A = await import('../src/lib/academie/pur.ts')
const PM = await import('../src/lib/academie/prix-membre-pur.ts')
const PP = await import('../src/lib/pilotage-paliers.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

const PRODUITS = ['prod_LiveClubTest01']
const maintenant = Math.floor(Date.now() / 1000)
const futur = maintenant + 30 * 86400
const passe = maintenant - 30 * 86400
const abo = (o = {}) => ({
  id: 'sub_Test0000001', status: 'active', customer: 'cus_Test00000001',
  items: { data: [{ current_period_end: futur, price: { product: PRODUITS[0] } }] },
  latest_invoice: { status: 'paid', status_transitions: { paid_at: passe } },
  ...o,
})
const resume = (o) => P.resumerAbonnement(abo(o), PRODUITS)

// Le chemin complet d'une lecture : abonnements d'un email -> etat -> conclusion -> Premium.
const directDe = (lectures, o = {}) => C.conclureLiveClubCompte({
  sansStripe: o.sansStripe ?? null, filetCockpit: o.filet ?? false,
  stripe: lectures.map(abos => C.etatDesAbonnements(P.meilleurAbonnement(abos) !== null, o.produitsComplets ?? true)),
})

await bloc('trialing sans aucune charge : Live Club oui, Carnet et Pilotage Premium', () => {
  const essai = resume({ id: 'sub_Essai000001', status: 'trialing', latest_invoice: null })
  assert.ok(essai, 'abonnement en essai lu')
  assert.ok(P.meilleurAbonnement([essai]))
  const d = directDe([[essai]])
  assert.deepEqual(d, { statut: 'oui', source: 'abonnement' })
  // La vue du cockpit ne le voit pas (abonnement sans charge = orphelin du pipeline) : le direct suffit.
  assert.equal(C.premiumParLiveClub({ vue: false, direct: d.statut }), true)
  assert.equal(C.premiumParLiveClub({ vue: null, direct: d.statut }), true)
  // Raison 'liveclub' : Pilotage Premium.
  assert.ok(PP.RAISONS_CLUB_PILOTAGE.includes('liveclub'))
  assert.equal(PP.resoudrePalier({ sansPlafond: false, produits: [], raisonCarnet: 'liveclub' }).palier, 'premium')
})

await bloc('ancien mensuel annule et nouveau forfait actif : le forfait compte', () => {
  const ancien = resume({ id: 'sub_Mensuel0001', status: 'canceled', ended_at: passe, latest_invoice: { status: 'paid', status_transitions: { paid_at: passe - 30 * 86400 } }, items: { data: [{ current_period_end: passe, price: { product: PRODUITS[0] } }] } })
  const forfait = resume({ id: 'sub_Forfait0001', status: 'active', items: { data: [{ current_period_end: futur + 60 * 86400, price: { product: PRODUITS[0] } }] } })
  assert.equal(P.meilleurAbonnement([ancien, forfait]).id, 'sub_Forfait0001')
  assert.equal(P.meilleurAbonnement([ancien]), null)
  // Le forfait en essai apres l'annulation du mensuel : meme chose.
  const forfaitEssai = resume({ id: 'sub_Forfait0002', status: 'trialing', latest_invoice: null })
  assert.equal(P.meilleurAbonnement([ancien, forfaitEssai]).id, 'sub_Forfait0002')
  // La vue tombe a false (COALESCE sur les lignes d'abonnement) : le direct garde le Premium.
  assert.equal(C.premiumParLiveClub({ vue: false, direct: directDe([[ancien, forfait]]).statut }), true)
  // Ne jamais retirer : la vue seule continue d'ouvrir.
  assert.equal(C.premiumParLiveClub({ vue: true, direct: 'non' }), true)
  assert.equal(C.premiumParLiveClub({ vue: false, direct: 'non' }), false)
})

await bloc('forfait sous un autre email de la meme fiche : emails connus, ordre, plafonds', () => {
  const emails = C.emailsDuCompte({
    verifies: ['b@exemple.fr'],
    fiche: ['B@Exemple.fr ', 'a@exemple.fr', null, 'pas-un-email'],
    rattachements: ['c@exemple.fr', 'a@exemple.fr'],
  })
  assert.deepEqual(emails, ['b@exemple.fr', 'a@exemple.fr', 'c@exemple.fr'])
  // Le forfait est sur a@ : le compte (b@) est reconnu.
  const forfait = resume({ id: 'sub_Forfait0003' })
  assert.deepEqual(directDe([[], [forfait], []]), { statut: 'oui', source: 'abonnement' })
  // Sans fiche ni rattachement : les seuls verifies.
  assert.deepEqual(C.emailsDuCompte({ verifies: ['b@exemple.fr'] }), ['b@exemple.fr'])
  // Plafond : 10 emails au plus, les verifies d'abord.
  const beaucoup = Array.from({ length: 20 }, (_, i) => `x${i}@exemple.fr`)
  const plafonne = C.emailsDuCompte({ verifies: ['v@exemple.fr'], fiche: beaucoup })
  assert.equal(plafonne.length, C.MAX_EMAILS_COMPTE)
  assert.equal(plafonne[0], 'v@exemple.fr')
  // Clients Stripe des rattachements : cus_ seulement, sans doublon, 5 au plus.
  assert.deepEqual(C.clientsDuCompte(['cus_AbCdEf123456', 'cus_AbCdEf123456', 'acct_123', null, ' cus_ZyXwVu987654 ']), ['cus_AbCdEf123456', 'cus_ZyXwVu987654'])
  assert.equal(C.clientsDuCompte(Array.from({ length: 9 }, (_, i) => `cus_Client0000${i}`)).length, C.MAX_CLIENTS_COMPTE)
})

await bloc('Stripe en delai depasse : inconnu, jamais un faux non ; la vue decide ; l achat attend', async () => {
  // avecDelai : une promesse qui ne repond pas rejette avec DelaiDepasse.
  await assert.rejects(C.avecDelai(new Promise(() => {}), 20), e => e instanceof C.DelaiDepasse && e.name === 'DelaiDepasse')
  assert.equal(await C.avecDelai(Promise.resolve(7), 1000), 7)
  // Une lecture inconnue et aucune autre en oui : inconnu.
  assert.deepEqual(C.conclureLiveClubCompte({ sansStripe: null, filetCockpit: false, stripe: ['non', 'inconnu'] }), { statut: 'inconnu', source: null })
  // Un oui ailleurs l'emporte.
  assert.equal(C.conclureLiveClubCompte({ sansStripe: null, filetCockpit: false, stripe: ['inconnu', 'oui'] }).statut, 'oui')
  // Emails connus illisibles : inconnu, pas non.
  assert.equal(C.conclureLiveClubCompte({ sansStripe: null, filetCockpit: false, stripe: ['non'], lectureIncomplete: true }).statut, 'inconnu')
  // Liste des produits incomplete : pas de non.
  assert.equal(C.etatDesAbonnements(false, false), 'inconnu')
  assert.equal(C.etatDesAbonnements(false, true), 'non')
  // Le filet du cockpit d'abord : Stripe lent ne retire rien.
  assert.deepEqual(C.conclureLiveClubCompte({ sansStripe: null, filetCockpit: true, stripe: ['inconnu'] }), { statut: 'oui', source: 'cockpit' })
  // Carnet : inconnu en direct = la vue seule (pas d'echec, pas de retrait).
  assert.equal(C.premiumParLiveClub({ vue: true, direct: 'inconnu' }), true)
  assert.equal(C.premiumParLiveClub({ vue: false, direct: 'inconnu' }), false)
  // Un inconnu ne se met pas en cache ; oui 10 min, non 1 min.
  assert.equal(C.dureeCacheCompte('inconnu'), 0)
  assert.equal(C.dureeCacheCompte('oui'), 600000)
  assert.equal(C.dureeCacheCompte('non'), 60000)
  // Prix membres : statut inconnu, aucun tarif applique = on ne vend pas au prix plein.
  const tarif = { cible: 'module-x', moduleId: null, slug: 'module-x-membres-bf', prixEur: 25, stripePriceId: 'price_Test01', debut: new Date(Date.now() - 3600e3), fin: new Date(Date.now() + 3600e3) }
  assert.equal(PM.achatAVerifier({ tarif: null, incertain: true }), true)
  assert.equal(PM.achatAVerifier({ tarif, incertain: false }), false)
  assert.equal(PM.achatAVerifier({ tarif: null, incertain: false }), false)
  assert.equal(PM.ERREUR_MEMBRE_INCONNU, 'membre_inconnu')
  assert.ok(PM.TEXTE_MEMBRE_INCONNU.includes('réessaie') || PM.TEXTE_MEMBRE_INCONNU.includes('Réessaie'))
  assert.ok(!/[–—]/.test(PM.TEXTE_MEMBRE_INCONNU), 'aucun tiret long')
})

await bloc('broker, exemption, acces manuel : oui sans Stripe', () => {
  assert.equal(A.sourceSansStripe({ broker_jusquau: '2026-12-31' }), 'broker')
  assert.equal(A.sourceSansStripe({ exempte: true }), 'exemption')
  assert.equal(A.sourceSansStripe({ manuel_jusquau: '2026-12-31' }), 'manuel')
  assert.deepEqual(C.conclureLiveClubCompte({ sansStripe: 'broker', filetCockpit: false, stripe: ['inconnu'] }), { statut: 'oui', source: 'broker' })
  // Le depot broker ouvre donc aussi le Carnet et Pilotage Premium.
  assert.equal(C.premiumParLiveClub({ vue: false, direct: 'oui' }), true)
})

await bloc('ETM : chemin du Carnet inchange, prix membre sans blocage', () => {
  const ent = lire('src/lib/entitlements.ts')
  const fonction = ent.slice(ent.indexOf('export async function checkMentoratAccess'))
  const iEtm = fonction.indexOf("reason: 'etm'")
  const iDirect = fonction.indexOf('liveClubEnDirect(userId)')
  assert.ok(iEtm > 0 && iDirect > iEtm, "l'ETM est lu avant le Live Club en direct")
  // Un ETM : Live Club non lu par l'academie (il a deja tout) : jamais 'inconnu', donc jamais bloque.
  const d = { liveClub: 'non_lu', ouvertures: [] }
  assert.equal(PM.membreDuTarif(d, 'module-x', null), false)
  assert.equal(PM.achatAVerifier({ tarif: null, incertain: d.liveClub === 'inconnu' }), false)
})

await bloc('cablage', () => {
  const ent = lire('src/lib/entitlements.ts')
  const fonction = ent.slice(ent.indexOf('export async function checkMentoratAccess'))
  // Le direct est lu apres tous les droits de la base. Un payeur du Carnet qui est aussi membre du Live Club garde la
  // raison 'liveclub' (elle ouvre Pilotage Premium) : le direct est relu dans le bloc carnet-premium, avant son return.
  const blocCarnet = fonction.slice(fonction.indexOf('if (await hasCarnetPremium(userId, email))'))
  assert.ok(blocCarnet.indexOf("(await liveClubEnDirect(userId)) === 'oui'") < blocCarnet.indexOf("reason: 'carnet-premium'"))
  // (27/11/2026) Seule exception : le Carnet Max relit le direct pour garder 'liveclub', comme le Carnet Premium.
  const avantDuo = fonction.slice(0, fonction.indexOf("reason: 'duo'"))
  assert.equal(avantDuo.split('liveClubEnDirect(userId)').length - 1, 1)
  assert.match(avantDuo, /if \(max === 'carnet-max' && \(await liveClubEnDirect\(userId\)\) === 'oui'\) return \{ entitled: true, reason: 'liveclub', email \}/)
  assert.match(fonction, /premiumParLiveClub\(\{ vue: m\?\.abonnement_en_cours, direct: await liveClubEnDirect\(userId\) \}\)\) \{\n\s+return \{ entitled: true, reason: 'liveclub', email \}/)
  // La vue reste lue.
  assert.match(fonction, /if \(m\.abonnement_en_cours\) return \{ entitled: true, reason: 'liveclub', email \}/)
  const da = lire('src/lib/academie/droits.ts')
  assert.match(da, /liveClubDuCompte\(emails, \{ faitsVerifies: c \?\? null \}\)/)
  assert.ok(!da.includes('async function liveClubParEmail'), 'le cache Stripe vit dans liveclub/compte.ts')
  const compte = lire('src/lib/liveclub/compte.ts')
  assert.match(compte, /STRIPE_DELAI_MS = 4000/)
  assert.ok(compte.includes('cockpit_liveclub_rattachements') && compte.includes('cockpit_membre_emails'))
  const dl = lire('src/lib/liveclub/droits.ts')
  assert.ok(dl.includes('autresEmailsDeLaFiche(rattachement.membre_id'), 'droitLiveClub lit les autres emails de la fiche')
  assert.ok(dl.includes("erreurs.push(`stripe_fiche:"), 'une lecture ratee de la fiche = inconnu, pas non')
  const achat = lire('src/app/api/academie/achat/route.ts')
  assert.ok(achat.includes('achatAVerifier(calcul)') && achat.includes('ERREUR_MEMBRE_INCONNU'))
  const paypal = lire('src/app/api/club/paypal/commande/route.ts')
  assert.ok(paypal.includes('achatAVerifier(calcul)'))
  const pm = lire('src/lib/academie/prix-membre.ts')
  assert.match(pm, /return \{ \.\.\.courant, incertain: true \}/)
  // Aucun montant, price_id ni date de tarif ecrit en dur dans les fichiers touches.
  for (const t of [compte, lire('src/lib/liveclub/compte-pur.ts'), pm]) assert.ok(!/price_[A-Za-z0-9]{10,}/.test(t))
})

console.log(`\n${n} blocs ok`)
