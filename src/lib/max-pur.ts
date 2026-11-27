// Le Max (Carnet Max et Duo Max), regles pures, sans base ni reseau
// (27/11/2026, chantier D:\7_Agents\chantiers\2026-11-27_lancement-max.md ;
// decisions du 11/11 : D:\7_Agents\briefs\2026-11-11-labo-carnet-max.md).
// Teste seul : scripts/verifier-max.mjs.
//
// Les paliers du Carnet : Libre / Premium / Max. Le Max donne environ trois
// fois plus d'etudes (budget IA du niveau 'club', 4 EUR sur 30 jours, contre
// 1,40 EUR au Premium), jamais « une meilleure IA ». Aucune offre n'inclut le
// Max : les voies d'adhesion (Live Club, formation, ETM, Skool, acces manuel)
// donnent le Premium. L'equipe AOK garde le niveau le plus haut, et le sans
// plafond reste celui des comptes maison (ia-budget.ts, estSansPlafond).
//
// La valeur 'club' est GARDEE cote API pour le Max : l'extension publiee (1.11.0)
// ne connait que 'club' | 'premium' | 'libre' | 'aucun' (sync.ts NiveauIA,
// PlansView.tsx) ; une valeur 'max' l'aurait fait retomber sur l'ecran du libre
// pour un acheteur du Max. Seul change QUI obtient 'club'.
//
// La vente : Stripe Checkout HEBERGE (la boutique d'aoknowledge.com redirige),
// abonnement, sur le Stripe Ao Knowledge. Le coupon est choisi par le serveur et
// pose par `discounts` (jamais avec allow_promotion_codes, Stripe refuse les
// deux) jusqu'a FIN_COUPONS_MAX : membre connecte -50 %, sinon -25 % (le BF26 du
// Max, que le code BF26 ne couvre pas). Ensuite, le prix plein.

import { CATALOGUE_MAX, NOMS_PRODUITS_MAX, OFFRES_MAX, URL_CGV, estSlugMax, type SlugOffreMax } from './pilotage-paliers'

// ---------------------------------------------------------------------------
// Les niveaux
// ---------------------------------------------------------------------------

/** Les raisons de checkMentoratAccess (entitlements.ts) qui viennent d'un abonnement Max. */
export const RAISONS_MAX = ['carnet-max', 'duo-max'] as const

/**
 * Le niveau IA d'un compte qui a un droit (checkMentoratAccess entitled) :
 * 'club' (le budget du Max) pour l'equipe et pour un abonnement Max actif
 * (`max`, lu a part : un membre du Live Club qui achete le Max garde sa raison
 * 'liveclub', qui lui ouvre Pilotage Premium) ; 'premium' pour tout le reste,
 * voies d'adhesion comprises (27/11/2026).
 */
export function niveauIADe(o: { raison: string | null; max: boolean }): 'club' | 'premium' {
  if (o.raison === 'equipe') return 'club'
  if (o.max || (RAISONS_MAX as readonly string[]).includes(o.raison ?? '')) return 'club'
  return 'premium'
}

// ---------------------------------------------------------------------------
// Les coupons (crees chez Stripe AOKnowledge par l'Orchestre Prix le 27/11/2026)
// ---------------------------------------------------------------------------

/** -50 %, duration once, Max seulement : un MEMBRE connecte (Live Club actif, formation longue ou ETM). */
export const COUPON_MAX_MEMBRES = 'RVLTiTdv'
/** -25 %, duration once, Max seulement : tout autre acheteur (le BF26 de la boutique pour le Max). */
export const COUPON_MAX_NON_MEMBRES = 'DKpZhWGh'
/** Fin des deux coupons : le 30/11/2026 a 23:59:59 heure de Paris compris, donc le 01/12 0 h exclu. */
export const FIN_COUPONS_MAX = new Date('2026-12-01T00:00:00+01:00')

/** Le coupon de la session : membre -50 %, sinon -25 %, et plus rien a partir de FIN_COUPONS_MAX. */
export function couponMax(o: { quand: Date; membre: boolean }): string | null {
  const t = o.quand.getTime()
  if (!Number.isFinite(t) || t >= FIN_COUPONS_MAX.getTime()) return null
  return o.membre ? COUPON_MAX_MEMBRES : COUPON_MAX_NON_MEMBRES
}

// ---------------------------------------------------------------------------
// La vente
// ---------------------------------------------------------------------------

export { OFFRES_MAX, estSlugMax, type SlugOffreMax }

/** L'offre demandee : un des quatre slugs (carnet-max-mensuel, carnet-max-annuel, duo-max-mensuel, duo-max-annuel), sinon null. */
export const offreMax = (v: unknown): SlugOffreMax | null => (typeof v === 'string' && estSlugMax(v.trim()) ? (v.trim() as SlugOffreMax) : null)

export const SITE_MAX = 'https://aoknowledge.com'
/** Apres le paiement : Mon espace. */
export const SUCCES_MAX = `${SITE_MAX}/mon-espace?max=merci&session_id={CHECKOUT_SESSION_ID}`
/** Retour par defaut si l'acheteur abandonne : la boutique du Black Friday. */
export const RETOUR_MAX_DEFAUT = '/black-friday'

/**
 * La page d'abandon (cancel_url) : un chemin d'aoknowledge.com (« /black-friday »),
 * jamais un autre site. Absent : RETOUR_MAX_DEFAUT. Mal forme : null (400).
 */
export function retourMax(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return `${SITE_MAX}${RETOUR_MAX_DEFAUT}`
  if (typeof v !== 'string') return null
  const chemin = v.trim()
  if (!chemin.startsWith('/') || chemin.startsWith('//') || chemin.length > 200) return null
  if (/[\\\u0000-\u001f\u007f?#@]/.test(chemin)) return null
  return `${SITE_MAX}${chemin}`
}

export function texteRetractationMax(slug: SlugOffreMax): string {
  return `J'accepte les [conditions générales](${URL_CGV}) et je demande l'accès immédiat à ${NOMS_PRODUITS_MAX[CATALOGUE_MAX[slug].produit]} : je renonce à mon droit de rétractation de 14 jours.`
}

/**
 * Les parametres de POST /v1/checkout/sessions (hebergee, abonnement). Les
 * metadata (source max, pilotage_offre, user_id) sont celles que relit le
 * webhook des abonnements (/api/pilotage/achat/webhook, lireSessionPilotage,
 * lireAbonnement) a chaque evenement. Le coupon : discounts, JAMAIS
 * allow_promotion_codes.
 */
export function corpsSessionMax(o: {
  slug: SlugOffreMax; prix: string; annulerUrl: string; userId: string | null; email: string | null; coupon: string | null; essai: boolean
}): URLSearchParams {
  const c = new URLSearchParams()
  c.set('mode', 'subscription')
  c.set('success_url', SUCCES_MAX)
  c.set('cancel_url', o.annulerUrl)
  c.set('line_items[0][price]', o.prix)
  c.set('line_items[0][quantity]', '1')
  c.set('locale', 'fr')
  c.set('consent_collection[terms_of_service]', 'required')
  c.set('custom_text[terms_of_service_acceptance][message]', texteRetractationMax(o.slug))
  if (o.userId) {
    c.set('client_reference_id', o.userId)
    c.set('metadata[user_id]', o.userId)
    c.set('subscription_data[metadata][user_id]', o.userId)
  }
  if (o.email) c.set('customer_email', o.email)
  c.set('metadata[source]', 'max')
  c.set('metadata[pilotage_offre]', o.slug)
  c.set('metadata[essai]', o.essai ? '1' : '0')
  c.set('subscription_data[description]', NOMS_PRODUITS_MAX[CATALOGUE_MAX[o.slug].produit])
  c.set('subscription_data[metadata][source]', 'max')
  c.set('subscription_data[metadata][pilotage_offre]', o.slug)
  c.set('subscription_data[metadata][essai]', o.essai ? '1' : '0')
  if (o.coupon) {
    c.set('discounts[0][coupon]', o.coupon)
    c.set('metadata[coupon]', o.coupon)
  }
  return c
}

/**
 * Le montant reellement paye d'une facture Stripe (amount_paid, en centimes),
 * en euros ; null si illisible. Le droit d'un abonnement Max porte ce montant
 * (-50 % ou -25 % sur la premiere periode, puis le prix plein au renouvellement).
 */
export function montantPayeEur(facture: unknown): number | null {
  const f = facture && typeof facture === 'object' && !Array.isArray(facture) ? (facture as Record<string, unknown>) : {}
  const c = f.amount_paid
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) return null
  if (typeof f.currency === 'string' && f.currency.toLowerCase() !== 'eur') return null
  return Math.round(c) / 100
}
