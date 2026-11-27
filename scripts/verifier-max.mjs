// Le Max (27/11/2026, chantier 2026-11-27_lancement-max) : le niveau IA (le Max
// a le budget 'club', les voies d'adhesion passent au Premium, l'equipe reste en
// haut), les coupons et leur fin, le corps de la session Checkout (discounts,
// jamais allow_promotion_codes), le retour, le montant paye, le palier de
// Pilotage du Duo Max, la session relue par le webhook, puis le cablage (route
// publique, ia-niveau, entitlements). Fonctions pures et lecture du code :
// aucune base, aucun reseau.
// node scripts/verifier-max.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const M = await import('../src/lib/max-pur.ts')
const P = await import('../src/lib/pilotage-paliers.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

bloc('niveau : le Max et l equipe = club ; les voies d adhesion et le reste = premium', () => {
  for (const raison of ['etm', 'manuel', 'liveclub', 'skool-vip', 'skool-premium', 'formation', 'duo', 'carnet-premium']) {
    assert.equal(M.niveauIADe({ raison, max: false }), 'premium', raison)
    assert.equal(M.niveauIADe({ raison, max: true }), 'club', `${raison} + Max`)
  }
  assert.equal(M.niveauIADe({ raison: 'carnet-max', max: false }), 'club')
  assert.equal(M.niveauIADe({ raison: 'duo-max', max: false }), 'club')
  assert.equal(M.niveauIADe({ raison: 'equipe', max: false }), 'club')
  assert.equal(M.niveauIADe({ raison: null, max: false }), 'premium')
})

bloc('coupons : membre -50, sinon -25, rien a partir du 01/12 0 h Paris', () => {
  const avant = new Date('2026-11-27T12:00:00+01:00')
  assert.equal(M.couponMax({ quand: avant, membre: true }), 'RVLTiTdv')
  assert.equal(M.couponMax({ quand: avant, membre: false }), 'DKpZhWGh')
  const dernier = new Date('2026-11-30T23:59:59+01:00')
  assert.equal(M.couponMax({ quand: dernier, membre: true }), 'RVLTiTdv')
  assert.equal(M.couponMax({ quand: dernier, membre: false }), 'DKpZhWGh')
  assert.equal(M.couponMax({ quand: M.FIN_COUPONS_MAX, membre: true }), null)
  assert.equal(M.couponMax({ quand: new Date('2026-12-01T00:00:00+01:00'), membre: false }), null)
  assert.equal(M.couponMax({ quand: new Date('x'), membre: false }), null)
})

const base = { slug: 'carnet-max-mensuel', prix: 'price_1UgWaGEAT4qWdUNVdxHlfw03', annulerUrl: 'https://aoknowledge.com/black-friday', userId: null, email: null, essai: false }

bloc('session : discounts pose, jamais allow_promotion_codes, metadata source max', () => {
  const c = M.corpsSessionMax({ ...base, coupon: 'DKpZhWGh' })
  assert.equal(c.get('mode'), 'subscription')
  assert.equal(c.get('discounts[0][coupon]'), 'DKpZhWGh')
  assert.equal(c.has('allow_promotion_codes'), false)
  assert.equal(c.get('metadata[source]'), 'max')
  assert.equal(c.get('subscription_data[metadata][source]'), 'max')
  assert.equal(c.get('metadata[pilotage_offre]'), 'carnet-max-mensuel')
  assert.equal(c.get('subscription_data[metadata][pilotage_offre]'), 'carnet-max-mensuel')
  assert.equal(c.get('line_items[0][price]'), base.prix)
  assert.equal(c.get('cancel_url'), base.annulerUrl)
  assert.match(c.get('success_url'), /^https:\/\/aoknowledge\.com\/mon-espace\?max=merci&session_id=\{CHECKOUT_SESSION_ID\}$/)
  assert.equal(c.has('client_reference_id'), false)
  assert.equal(c.has('customer_email'), false)
  assert.match(c.get('custom_text[terms_of_service_acceptance][message]'), /Carnet Max/)
  const sans = M.corpsSessionMax({ ...base, coupon: null })
  assert.equal([...sans.keys()].some(k => k.startsWith('discounts')), false)
  assert.equal(sans.has('allow_promotion_codes'), false)
  const u = '3f2b8c1e-0000-4000-8000-000000000001'
  const avec = M.corpsSessionMax({ ...base, slug: 'duo-max-annuel', userId: u, email: 'x@example.com', coupon: 'RVLTiTdv' })
  assert.equal(avec.get('client_reference_id'), u)
  assert.equal(avec.get('subscription_data[metadata][user_id]'), u)
  assert.equal(avec.get('customer_email'), 'x@example.com')
  assert.match(avec.get('subscription_data[description]'), /Duo Max/)
})

bloc('offre et retour', () => {
  for (const s of ['carnet-max-mensuel', 'carnet-max-annuel', 'duo-max-mensuel', 'duo-max-annuel']) assert.equal(M.offreMax(s), s)
  assert.equal(M.offreMax('pilotage-premium-mensuel'), null)
  assert.equal(M.offreMax(3), null)
  assert.equal(M.retourMax(undefined), 'https://aoknowledge.com/black-friday')
  assert.equal(M.retourMax(''), 'https://aoknowledge.com/black-friday')
  assert.equal(M.retourMax('/tarifs'), 'https://aoknowledge.com/tarifs')
  for (const mauvais of ['//evil.com', 'https://evil.com', '/a?b', '/a#b', '/a@b', '/a\\b', 5]) assert.equal(M.retourMax(mauvais), null, String(mauvais))
})

bloc('montant paye : amount_paid en euros, null sinon', () => {
  assert.equal(M.montantPayeEur({ amount_paid: 899, currency: 'eur' }), 8.99)
  assert.equal(M.montantPayeEur({ amount_paid: 0, currency: 'eur' }), 0)
  assert.equal(M.montantPayeEur({ amount_paid: 899, currency: 'usd' }), null)
  assert.equal(M.montantPayeEur({}), null)
  assert.equal(M.montantPayeEur(null), null)
})

bloc('catalogue : les quatre prix du Max', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(P.CATALOGUE_MAX).map(([k, v]) => [k, v.centimes])),
    { 'carnet-max-mensuel': 1199, 'carnet-max-annuel': 11400, 'duo-max-mensuel': 1499, 'duo-max-annuel': 12900 })
  // Pilotage ne vend pas le Max.
  assert.equal(P.SLUGS_OFFRES_PILOTAGE.some(s => P.estSlugMax(s)), false)
})

bloc('Pilotage : le Duo Max ouvre Premium, le Carnet Max non', () => {
  const r = (o) => P.resoudrePalier({ sansPlafond: false, produits: [], raisonCarnet: null, ...o })
  assert.deepEqual(r({ produits: ['duo-max'] }), { palier: 'premium', raison: 'premium-duo' })
  assert.notEqual(r({ produits: ['carnet-max'] }).palier, 'premium')
  assert.equal(P.ouvrePilotage('duo-max'), true)
  assert.equal(P.ouvrePilotage('carnet-max'), false)
})

bloc('webhook : la session source max est lue', () => {
  const s = {
    id: 'cs_live_a1b2c3d4e5f6g7h8', mode: 'subscription', status: 'complete', payment_status: 'paid',
    subscription: 'sub_1AbCdEfGhIjKlMnO', metadata: { source: 'max', pilotage_offre: 'duo-max-mensuel', essai: '0' },
    customer_details: { email: 'x@example.com' }, created: 1795000000,
  }
  const lu = P.lireSessionPilotage(s)
  assert.equal(lu.ok, true)
  assert.equal(lu.offre, 'duo-max-mensuel')
  assert.equal(P.lireSessionPilotage({ ...s, metadata: { source: 'autre' } }).ok, false)
})

bloc('cablage : route publique, discounts, ia-niveau, entitlements', () => {
  assert.match(lire('../middleware.ts'), /'\/api\/max\/achat'/)
  const route = lire('../src/app/api/max/achat/route.ts')
  assert.equal(/allow_promotion_codes'?\s*[,:)]/.test(route.replace(/\/\*[\s\S]*?\*\//, '')), false)
  assert.match(route, /corpsSessionMax\(/)
  assert.match(route, /membreDuTarif\(droits, slug, null\)/)
  const niv = lire('../src/lib/ia-niveau.ts')
  assert.match(niv, /maxDuCompte\(userId, email\)/)
  assert.match(niv, /niveauIADe\(\{ raison: acces\.reason, max \}\)/)
  const ent = lire('../src/lib/entitlements.ts')
  const f = ent.slice(ent.indexOf('export async function checkMentoratAccess'))
  // Le Max APRES les voies d'adhesion (formation), AVANT le Duo.
  assert.ok(f.indexOf("reason: 'formation'") < f.indexOf('await maxDuCompte(userId, email)'))
  assert.ok(f.indexOf('await maxDuCompte(userId, email)') < f.indexOf("reason: 'duo'"))
  assert.match(ent, /where o\.slug in \('carnet-max-mensuel', 'carnet-max-annuel', 'duo-max-mensuel', 'duo-max-annuel'\)/)
  const ab = lire('../src/lib/pilotage-abonnement.ts')
  assert.match(ab, /estSlugMax\(ab\.offre\) && ab\.facture/)
})

console.log(`\n${n} blocs ok`)
