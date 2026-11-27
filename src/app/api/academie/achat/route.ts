import { NextRequest, NextResponse } from 'next/server'
import {
  cleAchat, clePublique, creerSession, emailConfirme, ErreurStripe, offreEnVente, offrePartieEnVente, ventePublique,
} from '@/lib/academie/achat'
import { offrePartie, retourSur, type OffreEnVente } from '@/lib/academie/achat-pur'
import { prixDuCompte, ventePartieDuCompte } from '@/lib/academie/prix-membre'
import {
  achatAVerifier, ERREUR_MEMBRE_INCONNU, ERREUR_PARTIE_RESERVEE, expirationSession, TEXTE_MEMBRE_INCONNU, TEXTE_PARTIE_RESERVEE,
} from '@/lib/academie/prix-membre-pur'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { libelleRemise, promoBf26, remiseCheckout } from '@/lib/code-promo-pur'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/achat : la session Stripe Embedded Checkout d'un module
 * vendu a l'unite (19/10/2026). Route PUBLIQUE (middleware.ts) : on peut
 * payer sans compte, Checkout demande l'email.
 *
 * Corps : { module: <slug>, offre?: 'module-<slug>-partie-<n>', retour: '/academie/<module>[/<lecon>]', essai?: true }
 * Bearer facultatif : connecte, l'email confirme est prerempli et le compte
 * part en client_reference_id (lu dans le jeton, jamais dans le corps).
 * Tant que ACADEMIE_ACHAT_PUBLIC n'est pas a 1, seule une demande essai passe
 * (page ouverte avec ?achat=essai) : l'achat test de Brice avant l'ouverture.
 *
 * offre (15/11/2026) : une PARTIE du module vendue seule (Smart Money
 * Technique, parties 1 et 2). La base dit si elle se vend (offrePartieEnVente :
 * slug exact, stripe_aok, prix et stripe_price_id, sections de ce module
 * seulement) ; le prix facture est celui de son stripe_price_id, jamais une
 * valeur de la page. Sans offre : le module entier, comme avant.
 *
 * Tarif membre (20/11/2026, Black Friday) : une partie (ou un module entier,
 * meme jour : les 7 modules vendus a l'unite) achetee par un compte
 * connecte membre du Live Club (membreDuTarif), dans la fenetre d'un tarif en base
 * (SQL_TARIFS_MEMBRES), se paie au stripe_price_id du tarif (prixDuCompte,
 * prix-membre.ts) ; la session expire au plus tard a la fin de la fenetre
 * (31 min au moins, minimum de Stripe). Le webhook ouvre l'offre de la partie.
 * Qui est membre (27/11/2026, Brice) : Live Club actif, formation longue
 * (formation-complete) achetee, ETM actuel ou ancien (membreDuTarif).
 *
 * Code promo (27/11/2026, Black Friday) : au prix courant, la session porte
 * BF26 deja applique (discounts), a defaut le champ code promo
 * (allow_promotion_codes), jusqu'a CODE_PROMO_JUSQUA (code-promo-pur.ts) ; avec
 * un tarif membre, jamais (pas de cumul). Le code et ses produits eligibles
 * sont dans Stripe ; s'il refuse la remise, la session est recreee avec le
 * champ seul. Le montant enregistre est amount_total, donc apres remise.
 *
 * Parties (28/11/2026, Brice) : une offre de PARTIE ne se vend qu'a un compte
 * connecte membre du Live Club (ventePartie) : sinon 403
 * 'partie_reservee_membres' { message } ; Live Club illisible, 503 'membre_inconnu'.
 *
 * 200 { ok, client_secret, session_id, cle_publique }
 * 400 'corps' | 403 'ferme' | 404 'module' (pas en vente) | 503 'config' (cle absente ou sans permission) | 502 'stripe'
 * 503 'membre_inconnu' (27/11/2026) : un tarif membre vaut mais le statut du compte n'a pas pu etre verifie ;
 *   { message, reessayer: true }, aucune session au prix plein.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const SITE = 'https://aoknowledge.com'
const ORIGINES_RETOUR = new Set(['https://aoknowledge.com', 'https://www.aoknowledge.com', 'http://localhost:5173'])

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let corps: Record<string, unknown>
  try { corps = (await req.json()) as Record<string, unknown> } catch { return refus('corps', 400) }
  const slug = typeof corps.module === 'string' && /^[a-z0-9-]{1,80}$/.test(corps.module) ? corps.module : null
  const retour = retourSur(corps.retour)
  if (!slug || !retour) return refus('corps', 400)
  // Une partie : son slug doit nommer une partie de CE module ; envoye mais illisible, on refuse (jamais le module a sa place).
  const partie = corps.offre === undefined || corps.offre === null ? null : offrePartie(corps.offre, slug)
  if (corps.offre !== undefined && corps.offre !== null && !partie) return refus('corps', 400)
  const essai = corps.essai === true
  if (!ventePublique() && !essai) return refus('ferme', 403)

  const cle = cleAchat()
  const publique = clePublique()
  if (!cle || !publique) {
    console.warn(`[academie/achat] config absente (${!cle ? 'cle Checkout' : ''}${!cle && !publique ? ', ' : ''}${!publique ? 'cle publique' : ''})`)
    return refus('config', 503)
  }

  // Un jeton refuse ou Supabase injoignable : on vend quand meme, sans compte (l'email de Checkout ouvrira l'acces).
  let userId: string | null = null
  let email: string | null = null
  try {
    userId = await compteDuJeton(req)
    if (userId) email = await emailConfirme(userId)
  } catch (err) {
    console.warn(`[academie/achat] compte illisible, vente sans compte : ${messageErreur(err)}`)
    userId = null
    email = null
  }

  // prixEur : le prix courant de l'offre vendue (une partie ou, depuis le 20/11, le module entier), base du tarif membre.
  let offre: (OffreEnVente & { prixEur?: number }) | null
  try {
    offre = partie ? await offrePartieEnVente(slug, partie) : await offreEnVente(slug)
  } catch (err) {
    console.warn(`[academie/achat] base illisible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!offre) return refus('module', 404)
  const prixCourant = typeof offre.prixEur === 'number' && Number.isFinite(offre.prixEur) ? offre.prixEur : null

  // (28/11/2026, Brice) Une PARTIE de module ne se vend qu'a un membre du Live Club (ventePartie) : sans compte ou sans
  // Live Club actif, 403 'partie_reservee_membres' ; Live Club illisible, 503 'membre_inconnu' (reessayer).
  const vente = await ventePartieDuCompte(userId, offre.offreSlug)
  if (vente.decision === 'reservee') {
    console.info(`[academie/achat] partie reservee aux membres offre=${offre.offreSlug} compte=${userId ? tronquer(userId) : 'aucun'}`)
    return refusAcademie(ERREUR_PARTIE_RESERVEE, 403, headers, { message: TEXTE_PARTIE_RESERVEE })
  }
  if (vente.decision === 'inconnu') {
    console.warn(`[academie/achat] statut membre inconnu, partie suspendue offre=${offre.offreSlug} compte=${userId ? tronquer(userId) : 'aucun'}`)
    return refusAcademie(ERREUR_MEMBRE_INCONNU, 503, headers, { message: TEXTE_MEMBRE_INCONNU, reessayer: true })
  }

  // (20/11/2026) Le tarif membre d'une partie ou d'un module entier (prix-membre-pur.ts, le seul calcul ; qui y a droit :
  // membreDuTarif) : un membre du Live Club, dans la fenetre du tarif en base, paie son stripe_price_id. Sans tarif en
  // base pour l'offre, ou si la base ou ses droits sont illisibles : le prix courant (Checkout affiche le montant avant
  // le paiement). La page n'envoie jamais de prix.
  let expiresAt: number | null = null
  if (userId && prixCourant !== null && prixCourant > 0) {
    const maintenant = new Date()
    let calcul: Awaited<ReturnType<typeof prixDuCompte>> | null = null
    try {
      calcul = await prixDuCompte({ userId, offre: offre.offreSlug, prixCourantEur: prixCourant, quand: maintenant, droits: vente.droits ?? undefined })
    } catch (err) {
      console.warn(`[academie/achat] tarif membre illisible, prix courant offre=${offre.offreSlug} : ${messageErreur(err)}`)
    }
    // (27/11/2026, correctif des bonus membres) Un tarif vaut et le statut du compte reste inconnu (Stripe lent ou
    // illisible, apres le filet du cockpit) : pas de session au prix plein. 503 'membre_inconnu' et son message ; la
    // page propose de reessayer (le cache Stripe ne garde pas un 'inconnu', l'essai suivant relit).
    if (calcul && achatAVerifier(calcul)) {
      console.warn(`[academie/achat] statut membre inconnu, achat suspendu offre=${offre.offreSlug} compte=${tronquer(userId)}`)
      return refusAcademie(ERREUR_MEMBRE_INCONNU, 503, headers, { message: TEXTE_MEMBRE_INCONNU, reessayer: true })
    }
    if (calcul?.tarif) {
      offre = { ...offre, stripePriceId: calcul.tarif.stripePriceId, tarif: calcul.tarif.slug }
      expiresAt = expirationSession(calcul.tarif.fin, maintenant)
    }
  }

  const origin = req.headers.get('origin')
  const base = origin && ORIGINES_RETOUR.has(origin) ? origin : SITE
  const retourUrl = `${base}${retour}?achat_session={CHECKOUT_SESSION_ID}`
  // (27/11/2026, Black Friday) BF26 deja applique (discounts), a defaut son champ (allow_promotion_codes) : au prix
  // courant seulement, jamais avec un tarif membre, jusqu'a CODE_PROMO_JUSQUA (code-promo-pur.ts).
  const remise = remiseCheckout({ quand: new Date(), prixMembre: Boolean(offre.tarif), promo: promoBf26(process.env) })

  try {
    const s = await creerSession(cle, offre, { retourUrl, userId, email, essai, expiresAt, remise })
    console.info(`[academie/achat] session creee module=${slug}${partie ? ` offre=${partie}` : ''}${offre.tarif ? ` tarif=${offre.tarif}` : ''}${libelleRemise(s.remise)} compte=${userId ? tronquer(userId) : 'aucun'}${essai ? ' essai' : ''}`)
    return NextResponse.json({ ok: true, client_secret: s.clientSecret, session_id: s.id, cle_publique: publique }, { headers })
  } catch (err) {
    if (err instanceof ErreurStripe && (err.permission || err.statut === 401)) {
      console.warn(`[academie/achat] cle Stripe sans la permission Checkout Sessions (${err.statut})`)
      return refus('config', 503)
    }
    if (err instanceof ErreurStripe && err.conditions) {
      console.warn('[academie/achat] Stripe exige une URL de conditions dans les reglages publics du compte (consent_collection)')
      return refus('config', 503)
    }
    console.warn(`[academie/achat] Stripe a refuse la session module=${slug} : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return refus('stripe', 502)
  }
}
