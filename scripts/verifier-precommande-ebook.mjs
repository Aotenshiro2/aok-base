// Verifie la precommande de l'e-book « La strategie qui te ressemble » (27/11/2026),
// hors ligne, sans Stripe ni base : la remise (coupon avant la borne, rien apres,
// jamais BF26 ni tarif membre), le module hors catalogue, la session Checkout
// (texte de precommande, pas de renonciation) et le mail.
//
//   node scripts/verifier-precommande-ebook.mjs
//
// Node 22 retire les types tout seul : le .ts est importe tel quel.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  COUPON_EBOOK, COUPON_EBOOK_JUSQUA, MODULE_EBOOK, OFFRE_EBOOK, PAGE_EBOOK, TEXTE_CONDITIONS_PRECOMMANDE, TEXTE_SUBMIT_PRECOMMANDE,
  couponEbook, estPrecommande, horsCatalogue, remiseEbook, retourPrecommande, visibleDansLaVue,
} from '../src/lib/academie/precommande-pur.ts'
import { corpsSession, lireAchat, TEXTE_RETRACTATION } from '../src/lib/academie/achat-pur.ts'
import { CODE_PROMO_JUSQUA, libelleRemise, remiseAppliquee, sansRemiseAppliquee } from '../src/lib/code-promo-pur.ts'
import { modeleModule } from '../src/lib/mails-achat-pur.ts'

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

bloc('identifiants : module, offre, page', () => {
  assert.equal(MODULE_EBOOK, 'ebook-la-strategie-qui-te-ressemble')
  assert.equal(OFFRE_EBOOK, 'module-ebook-la-strategie-qui-te-ressemble')
  assert.equal(PAGE_EBOOK, '/library/ebook-la-strategie-qui-te-ressemble')
  assert.equal(estPrecommande(OFFRE_EBOOK), true)
  assert.equal(estPrecommande('module-journaling'), false)
})

bloc('coupon : celui de Prix, remplacable ou coupe par la variable', () => {
  assert.equal(COUPON_EBOOK, '84vsea9o')
  assert.equal(couponEbook({}), '84vsea9o')
  assert.equal(couponEbook({ COUPON_EBOOK_PRECOMMANDE: 'autreId' }), 'autreId')
  assert.equal(couponEbook({ COUPON_EBOOK_PRECOMMANDE: 'aucun' }), null)
  assert.equal(couponEbook({ COUPON_EBOOK_PRECOMMANDE: 'AUCUN ' }), null)
  // Une valeur illisible ne casse rien : le coupon de Prix.
  assert.equal(couponEbook({ COUPON_EBOOK_PRECOMMANDE: 'a b;c' }), '84vsea9o')
})

bloc('borne : lundi 30/11 23 h 58 59 heure de Paris, une minute avant le redeem_by de Stripe', () => {
  assert.equal(COUPON_EBOOK_JUSQUA.toISOString(), '2026-11-30T22:58:59.000Z')
  assert.ok(COUPON_EBOOK_JUSQUA.getTime() < CODE_PROMO_JUSQUA.getTime())
  assert.ok(CODE_PROMO_JUSQUA.getTime() - COUPON_EBOOK_JUSQUA.getTime() <= 61_000)
})

bloc('remise avant la borne : le coupon, pour tout le monde', () => {
  for (const quand of [new Date('2026-11-27T12:00:00+01:00'), new Date('2026-11-30T23:58:58+01:00')]) {
    assert.deepEqual(remiseEbook({ quand, coupon: '84vsea9o' }), { coupon: '84vsea9o' })
  }
})

bloc('remise a la borne et apres : rien (39 EUR, la vente continue)', () => {
  for (const quand of [COUPON_EBOOK_JUSQUA, new Date('2026-11-30T23:59:00+01:00'), new Date('2026-12-01T00:00:00+01:00'), new Date('2027-02-10T10:00:00+01:00')]) {
    assert.equal(remiseEbook({ quand, coupon: '84vsea9o' }), null, quand.toISOString())
  }
  assert.equal(remiseEbook({ quand: new Date('invalide'), coupon: '84vsea9o' }), null)
})

bloc('sans coupon configure : aucune remise, aucune erreur', () => {
  assert.equal(remiseEbook({ quand: new Date('2026-11-28T10:00:00+01:00'), coupon: null }), null)
  assert.equal(remiseEbook({ quand: new Date('2026-11-28T10:00:00+01:00'), coupon: couponEbook({ COUPON_EBOOK_PRECOMMANDE: 'aucun' }) }), null)
})

const ebook = {
  moduleSlug: MODULE_EBOOK, moduleTitre: 'La stratégie qui te ressemble (e-book)', offreSlug: OFFRE_EBOOK, stripePriceId: 'price_1UgXOUEAT4qWdUNVtCi6zuid',
  precommande: { conditions: TEXTE_CONDITIONS_PRECOMMANDE, submit: TEXTE_SUBMIT_PRECOMMANDE },
}
const retourUrl = `https://aoknowledge.com${PAGE_EBOOK}?achat_session={CHECKOUT_SESSION_ID}`

bloc('session : le coupon dans discounts[0][coupon], jamais BF26 ni le champ', () => {
  const c = corpsSession(ebook, { retourUrl, userId: null, email: null, essai: false, remise: remiseEbook({ quand: new Date('2026-11-28T10:00:00+01:00'), coupon: '84vsea9o' }) })
  assert.equal(c.get('discounts[0][coupon]'), '84vsea9o')
  assert.equal(c.get('discounts[0][promotion_code]'), null)
  assert.equal(c.get('allow_promotion_codes'), null)
  assert.equal(c.get('line_items[0][price]'), 'price_1UgXOUEAT4qWdUNVtCi6zuid')
  assert.equal(c.get('metadata[academie_offre]'), OFFRE_EBOOK)
  assert.equal(c.get('metadata[academie_tarif]'), null)
})

bloc('session apres la borne : ni coupon, ni BF26, ni champ', () => {
  const c = corpsSession(ebook, { retourUrl, userId: 'u1', email: 'a@b.fr', essai: false, remise: remiseEbook({ quand: new Date('2026-12-01T09:00:00+01:00'), coupon: '84vsea9o' }) })
  for (const k of ['discounts[0][coupon]', 'discounts[0][promotion_code]', 'allow_promotion_codes']) assert.equal(c.get(k), null, k)
})

bloc('session : texte de precommande, livraison en fevrier 2027, pas de renonciation', () => {
  const c = corpsSession(ebook, { retourUrl, userId: null, email: null, essai: false })
  assert.equal(c.get('custom_text[terms_of_service_acceptance][message]'), TEXTE_CONDITIONS_PRECOMMANDE)
  assert.doesNotMatch(c.get('custom_text[terms_of_service_acceptance][message]'), /renonce|rétractation/)
  assert.match(c.get('custom_text[submit][message]'), /Précommande.*février 2027/)
  assert.ok(c.get('custom_text[submit][message]').length <= 1200)
  assert.equal(c.get('metadata[precommande]'), '1')
  assert.equal(c.get('return_url'), retourUrl)
  // Un module ordinaire ne change pas.
  const m = corpsSession({ moduleSlug: 'journaling', moduleTitre: 'Journaling', offreSlug: 'module-journaling', stripePriceId: 'price_1' }, { retourUrl, userId: null, email: null, essai: false })
  assert.equal(m.get('custom_text[terms_of_service_acceptance][message]'), TEXTE_RETRACTATION)
  assert.equal(m.get('custom_text[submit][message]'), null)
  assert.equal(m.get('metadata[precommande]'), null)
})

bloc('webhook : une precommande payee ne note aucune renonciation', () => {
  const session = (meta) => ({
    id: 'cs_live_abcdefghijkl', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 2925, created: 1796000000,
    customer_details: { email: 'a@b.fr' }, consent: { terms_of_service: 'accepted' },
    metadata: { source: 'academie', academie_module: MODULE_EBOOK, academie_offre: OFFRE_EBOOK, essai: '0', ...meta },
  })
  const p = lireAchat(session({ precommande: '1' }))
  assert.equal(p.ok, true)
  assert.equal(p.achat.renonciationLe, null)
  assert.equal(p.achat.montantEur, 29.25)
  assert.equal(p.achat.offreSlug, OFFRE_EBOOK)
  // Sans le drapeau (un module ordinaire), la renonciation reste notee.
  assert.ok(lireAchat(session({})).achat.renonciationLe instanceof Date)
})

bloc('repli quand Stripe refuse le coupon : sans remise, jamais le champ BF26', () => {
  assert.equal(remiseAppliquee({ coupon: 'x' }), true)
  assert.equal(remiseAppliquee({ promotionCode: 'promo_x' }), true)
  assert.equal(remiseAppliquee({ champ: true }), false)
  assert.equal(remiseAppliquee(null), false)
  assert.equal(sansRemiseAppliquee({ coupon: 'x' }), null)
  assert.deepEqual(sansRemiseAppliquee({ promotionCode: 'promo_x' }), { champ: true })
  assert.equal(libelleRemise({ coupon: 'x' }), ' coupon_ebook')
})

bloc('route : ni BF26 ni tarif membre pour l e-book, retour sur sa page', () => {
  const route = lire('../src/app/api/academie/achat/route.ts')
  assert.match(route, /const precommande = estPrecommande\(offre\.offreSlug\)/)
  assert.match(route, /if \(!precommande && userId && prixCourant !== null && prixCourant > 0\) \{/)
  assert.match(route, /const remise = precommande\n\s+\? remiseEbook\(\{ quand: new Date\(\), coupon: couponEbook\(process\.env\) \}\)\n\s+: remiseCheckout\(/)
  assert.match(route, /retourSur\(corps\.retour\) \?\? retourPrecommande\(corps\.retour, slug\)/)
  assert.equal(retourPrecommande(PAGE_EBOOK, MODULE_EBOOK), PAGE_EBOOK)
  assert.equal(retourPrecommande(` ${PAGE_EBOOK} `, MODULE_EBOOK), PAGE_EBOOK)
  for (const x of ['/library/autre', `${PAGE_EBOOK}?x=1`, `${PAGE_EBOOK}/`, '//evil.com', 3, null]) assert.equal(retourPrecommande(x, MODULE_EBOOK), null, String(x))
  // La page de l'e-book n'est pas un retour pour un autre module.
  assert.equal(retourPrecommande(PAGE_EBOOK, 'journaling'), null)
})

bloc('catalogue : l e-book hors des cours, visible seulement chez qui l a achete', () => {
  assert.equal(horsCatalogue(MODULE_EBOOK), true)
  assert.equal(horsCatalogue('journaling'), false)
  const m = { id: 'mod-ebook', slug: MODULE_EBOOK }
  // Visiteur (/catalogue) ou compte sans achat : cache.
  assert.equal(visibleDansLaVue(m, []), false)
  assert.equal(visibleDansLaVue(m, [{ cible: { tout: false, moduleId: 'autre', sectionId: null } }]), false)
  // ETM ou admin (un droit qui ouvre tout) : cache, pas d'e-book vide dans les cours.
  assert.equal(visibleDansLaVue(m, [{ cible: { tout: true } }]), false)
  // L'acheteur : visible (en fevrier 2027, le PDF y sera une lecon).
  assert.equal(visibleDansLaVue(m, [{ cible: { tout: false, moduleId: 'mod-ebook', sectionId: null } }]), true)
  // Un module de cours reste visible pour tout le monde.
  assert.equal(visibleDansLaVue({ id: 'j', slug: 'journaling' }, []), true)
  assert.match(lire('../src/lib/academie/vue-moi.ts'), /catalogue\.modules\.filter\(m => visibleDansLaVue\(m, droits\.ouvertures\)\)/)
})

bloc('mail : precommande enregistree, livraison, sans acces ouvert ni renonciation', () => {
  const v = { prenom: 'Lea', montant: '29,25 euros', titreModule: 'La stratégie qui te ressemble (e-book)', lienModule: `https://aoknowledge.com${PAGE_EBOOK}`, email: 'a@b.fr', essai: false, precommande: 'en février 2027' }
  const mm = modeleModule(v)
  assert.equal(mm.objet, 'Votre précommande est enregistrée')
  const texte = mm.paragraphes.join('\n')
  assert.match(texte, /par mail à sa sortie, en février 2027/)
  assert.doesNotMatch(texte, /renonciation|est ouvert|première leçon/)
  assert.equal(mm.bouton.url, `https://aoknowledge.com${PAGE_EBOOK}`)
  // Un module ordinaire garde son mail.
  assert.match(modeleModule({ ...v, precommande: null }).objet, /est ouvert/)
})

console.log(`\n${n} blocs verifies`)
