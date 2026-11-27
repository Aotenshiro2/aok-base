// La precommande de l'e-book « La strategie qui te ressemble » (27/11/2026),
// sans reseau ni base. Testable seul (scripts/verifier-precommande-ebook.mjs).
//
// Decision de l'Orchestre Prix : AUCUNE route de paiement nouvelle. L'e-book
// est un module de l'academie (migration 20261127230000_ebook_precommande du
// workspace), vendu par POST /api/academie/achat comme les autres, avec trois
// ecarts, tous ici :
// - le module ne se montre pas comme un cours (horsCatalogue, vue-moi.ts) :
//   ni au catalogue public, ni dans /moi d'un compte qui ne l'a pas achete ;
//   l'acheteur le garde dans /moi (en fevrier 2027, le PDF y deviendra une
//   lecon) ;
// - la remise : le coupon de l'e-book (discounts[0][coupon]) jusqu'a
//   COUPON_EBOOK_JUSQUA, pour tout le monde, jamais BF26 ni tarif membre ;
//   apres, 39 EUR sans remise et la vente continue ;
// - la page revient sur /library/ebook-la-strategie-qui-te-ressemble (le
//   site), pas sur une page de l'academie (retourPrecommande).
// Le texte de Checkout dit precommande et livraison (achat-pur.ts, offre.precommande).
//
// Import de type seulement : efface a l'execution, le fichier reste testable seul par node.
import type { RemiseCheckout } from '../code-promo-pur'

/** Le module de l'e-book (academie_modules.slug). */
export const MODULE_EBOOK = 'ebook-la-strategie-qui-te-ressemble'

/** Son offre (academie_offres.slug) : 39 EUR, type module, canal stripe_aok. */
export const OFFRE_EBOOK = `module-${MODULE_EBOOK}`

/** La page de vente du site, seul retour accepte pour ce module hors de /academie/. */
export const PAGE_EBOOK = `/library/${MODULE_EBOOK}`

/** La livraison, telle qu'elle s'ecrit dans une phrase. */
export const LIVRAISON_EBOOK = 'en février 2027'

/**
 * Les modules qui ne sont pas des cours : jamais au catalogue public ni dans
 * les listes, seulement dans /moi de qui a un droit explicite dessus.
 */
export const MODULES_HORS_CATALOGUE: ReadonlySet<string> = new Set([MODULE_EBOOK])

export const horsCatalogue = (slug: string): boolean => MODULES_HORS_CATALOGUE.has(slug)

/** Une ouverture des droits, reduite a ce qu'il faut ici (Ouverture, pur.ts). */
type OuvertureLue = { cible: { tout: true } | { tout: false; moduleId: string } }

/**
 * Le module se montre-t-il dans la vue (vue-moi.ts, construire) ? Un module
 * de cours, toujours. Un module hors catalogue, seulement si le compte a un
 * droit qui le nomme (un achat de son offre) : un droit qui ouvre tout (ETM,
 * admin) ne suffit pas, sinon un ETM verrait un e-book vide dans ses cours.
 */
export function visibleDansLaVue(m: { id: string; slug: string }, ouvertures: readonly OuvertureLue[]): boolean {
  if (!horsCatalogue(m.slug)) return true
  return ouvertures.some(o => o.cible.tout === false && o.cible.moduleId === m.id)
}

/** Le chemin de retour du paiement de l'e-book : exactement sa page du site, sinon null. */
export function retourPrecommande(valeur: unknown, moduleSlug: string): string | null {
  if (moduleSlug !== MODULE_EBOOK || typeof valeur !== 'string') return null
  return valeur.trim() === PAGE_EBOOK ? PAGE_EBOOK : null
}

export const estPrecommande = (offreSlug: string): boolean => offreSlug === OFFRE_EBOOK

/**
 * L'id du coupon de la precommande (cree par l'Orchestre Prix le 27/11/2026
 * sur le compte AOKnowledge : -25 %, duration once, limite au produit de
 * l'e-book prod_VhxJen3kuqojcB, redeem_by le 30/11/2026 23:59 heure de Paris).
 * Un identifiant, pas un secret.
 */
export const COUPON_EBOOK = '84vsea9o'

/** La variable qui peut remplacer COUPON_EBOOK (un autre id) ou la couper ('aucun' : aucune remise). */
export const VARIABLE_COUPON_EBOOK = 'COUPON_EBOOK_PRECOMMANDE'

/**
 * Fin de la remise, exclue : lundi 30/11/2026 23 h 58 min 59 s, heure de Paris.
 * Stripe refuse le coupon des son redeem_by (23 h 59) et la session echouerait :
 * une minute de marge contre une horloge de serveur en avance. Meme jour que
 * CODE_PROMO_JUSQUA (code-promo-pur.ts), une minute plus tot.
 */
export const COUPON_EBOOK_JUSQUA = new Date('2026-11-30T23:58:59+01:00')

const ID_COUPON = /^[A-Za-z0-9_-]{1,64}$/

/** Le coupon a poser : la variable si elle porte un id, 'aucun' ou vide d'id valable = null, sinon COUPON_EBOOK. */
export function couponEbook(env: Record<string, string | undefined>): string | null {
  const v = env[VARIABLE_COUPON_EBOOK]?.trim()
  if (v && v.toLowerCase() === 'aucun') return null
  if (v && ID_COUPON.test(v)) return v
  return ID_COUPON.test(COUPON_EBOOK) ? COUPON_EBOOK : null
}

/**
 * La remise de la session de l'e-book : le coupon avant la borne, rien apres
 * ou sans coupon. Jamais BF26, jamais le champ code promo, quel que soit le
 * compte (meme prix pour tout le monde).
 */
export function remiseEbook(p: { quand: Date; coupon: string | null }): RemiseCheckout {
  const t = p.quand.getTime()
  if (!p.coupon || !Number.isFinite(t) || t >= COUPON_EBOOK_JUSQUA.getTime()) return null
  return { coupon: p.coupon }
}

/**
 * La case a cocher de Checkout pour une precommande : les conditions seules.
 * Pas de renonciation au droit de retractation, le contenu n'est pas fourni
 * tout de suite (il l'est en fevrier 2027).
 */
export const URL_CGV_PRECOMMANDE = 'https://aoknowledge.com/conditions-generales'
export const TEXTE_CONDITIONS_PRECOMMANDE = `J'accepte les [conditions générales](${URL_CGV_PRECOMMANDE}).`

/** Le texte au-dessus du bouton de paiement (custom_text[submit][message]). */
export const TEXTE_SUBMIT_PRECOMMANDE =
  `Précommande : tu paies aujourd'hui et tu reçois l'e-book par mail à sa sortie, ${LIVRAISON_EBOOK}.`
