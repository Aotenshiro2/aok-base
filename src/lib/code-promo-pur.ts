// Le code promo du Black Friday aux paiements Stripe Checkout du site, sans
// reseau ni base (27/11/2026). Testable seul (scripts/verifier-prix-membre-profils.mjs).
//
// La boutique du Black Friday annonce -25 % avec le code BF26. Brice (27/11) :
// le code doit etre DEJA APPLIQUE au paiement, sans saisie, comme les liens de
// The Futur. Le code promo est cree et limite aux produits eligibles DANS
// Stripe (compte AOKnowledge, par l'Orchestre Prix) : ce depot ne cree rien.
// Il pose seulement, sur les sessions Checkout qu'il cree lui-meme (un module
// de l'academie, achat-pur.ts corpsSession ; un abonnement Pilotage Premium ou
// Premium Duo, pilotage-paliers.ts corpsSessionAbonnement) :
// - discounts[0][promotion_code] = PROMO_BF26 (ou l'id de la variable
//   STRIPE_PROMO_BF26) : la remise est appliquee ;
// - STRIPE_PROMO_BF26 = 'aucun' : allow_promotion_codes, le champ ou l'on
//   saisit BF26 a la main. Stripe refuse les deux ensemble.
// Si Stripe refuse la remise (code inactif, produit hors du code...), la
// session est recreee une fois avec le champ seul (achat.ts, pilotage-abonnement.ts) :
// la vente ne tombe jamais a cause du code.
//
// Rien de tout cela :
// - quand un tarif membre s'applique (prix membre) : on ne cumule pas ;
// - pour un achat de soutien (le Premium deja compris) ;
// - pour un compte qui a deja l'app incluse (Live Club, Formation, ETM...) ;
// - a partir de CODE_PROMO_JUSQUA : plus rien, sans redeploiement.
// Revenir en arriere : STRIPE_PROMO_BF26=aucun (retour au champ seul), ou
// passer CODE_PROMO_JUSQUA a une date passee (plus rien du tout), ou revert.
//
// Abonnements : la remise porte sur ce que dit le coupon de BF26 dans Stripe
// (duration once : le 1er paiement seulement).
// PayPal (modules de Smart Money Technique, /api/club/paypal) : jamais de BF26.

/** Fin du code promo : mardi 01/12/2026 0 h, heure de Paris (exclue). */
export const CODE_PROMO_JUSQUA = new Date('2026-12-01T00:00:00+01:00')

/**
 * L'id du code promo BF26 (cree par l'Orchestre Prix le 27/11/2026, coupon
 * ZeN4oHT3 : -25 %, duration once, restreint aux 13 produits du Black Friday,
 * dont les 3 de Smart Money Technique ; expire le 30/11/2026 23:59:59 heure de
 * Paris, epoch 1796079599). Un identifiant, pas un secret.
 */
export const PROMO_BF26 = 'promo_1UgU4LEAT4qWdUNVNqM26u27'

/**
 * La variable d'environnement qui peut remplacer PROMO_BF26 (un autre id
 * promo_...) ou le couper : 'aucun' = le champ seul, sans remise appliquee.
 */
export const VARIABLE_PROMO_BF26 = 'STRIPE_PROMO_BF26'

/** Ce que la session Checkout recoit : la remise appliquee, le champ seul, ou rien. */
export type RemiseCheckout = { promotionCode: string } | { champ: true } | null

const ID_PROMO = /^promo_[A-Za-z0-9]+$/

/** L'id du code promo a appliquer : la variable si elle en porte un, 'aucun' = null (champ seul), sinon PROMO_BF26. */
export function promoBf26(env: Record<string, string | undefined>): string | null {
  const v = env[VARIABLE_PROMO_BF26]?.trim()
  if (v && v.toLowerCase() === 'aucun') return null
  if (v && ID_PROMO.test(v)) return v
  return PROMO_BF26
}

/**
 * La session Checkout a-t-elle droit au code promo ? Seulement au prix
 * courant (pas de tarif membre), hors soutien, pour un compte sans l'app
 * incluse, et avant CODE_PROMO_JUSQUA.
 */
export function champCodePromo(p: {
  quand: Date
  /** Un tarif membre est applique a cette session. */
  prixMembre: boolean
  /** Achat de soutien (soutien=1). */
  soutien?: boolean
  /** Le compte a deja ce qui est vendu (Premium compris par une formule). */
  compris?: boolean
}): boolean {
  if (p.prixMembre || p.soutien === true || p.compris === true) return false
  const t = p.quand.getTime()
  return Number.isFinite(t) && t < CODE_PROMO_JUSQUA.getTime()
}

/** La remise de la session : champCodePromo d'abord, puis l'id BF26 s'il est connu, sinon le champ. */
export function remiseCheckout(p: Parameters<typeof champCodePromo>[0] & { promo: string | null }): RemiseCheckout {
  if (!champCodePromo(p)) return null
  return p.promo ? { promotionCode: p.promo } : { champ: true }
}

/** Repli quand Stripe refuse la remise : le champ seul. */
export const sansRemiseAppliquee = (r: RemiseCheckout): RemiseCheckout => (r ? { champ: true } : null)

/** Pour les journaux : ce qui a ete pose. */
export const libelleRemise = (r: RemiseCheckout): string =>
  !r ? '' : 'promotionCode' in r ? ' remise_bf26' : ' code_promo'
