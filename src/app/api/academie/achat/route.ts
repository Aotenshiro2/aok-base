import { NextRequest, NextResponse } from 'next/server'
import {
  cleAchat, clePublique, creerSession, emailConfirme, ErreurStripe, offreEnVente, offrePartieEnVente, ventePublique,
} from '@/lib/academie/achat'
import { offrePartie, retourSur, type OffreEnVente } from '@/lib/academie/achat-pur'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
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
 * 200 { ok, client_secret, session_id, cle_publique }
 * 400 'corps' | 403 'ferme' | 404 'module' (pas en vente) | 503 'config' (cle absente ou sans permission) | 502 'stripe'
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

  let offre: OffreEnVente | null
  try {
    offre = partie ? await offrePartieEnVente(slug, partie) : await offreEnVente(slug)
  } catch (err) {
    console.warn(`[academie/achat] base illisible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!offre) return refus('module', 404)

  const origin = req.headers.get('origin')
  const base = origin && ORIGINES_RETOUR.has(origin) ? origin : SITE
  const retourUrl = `${base}${retour}?achat_session={CHECKOUT_SESSION_ID}`

  try {
    const s = await creerSession(cle, offre, { retourUrl, userId, email, essai })
    console.info(`[academie/achat] session creee module=${slug}${partie ? ` offre=${partie}` : ''} compte=${userId ? tronquer(userId) : 'aucun'}${essai ? ' essai' : ''}`)
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
