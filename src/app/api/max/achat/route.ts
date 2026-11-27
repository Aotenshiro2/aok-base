import { NextRequest, NextResponse } from 'next/server'
import { appeler, emailConfirme, ErreurStripe } from '@/lib/academie/achat'
import { droitsAcademie } from '@/lib/academie/droits'
import { compteDuJeton, tronquer } from '@/lib/academie/http'
import { membreDuTarif, membreHorsLiveClub } from '@/lib/academie/prix-membre-pur'
import { SQL_IDENTITE } from '@/lib/academie/requetes'
import { prisma } from '@/lib/db'
import { messageErreur } from '@/lib/liveclub/pur'
import { abonnementsDuMembre, clePilotage, prixDesOffres } from '@/lib/pilotage-abonnement'
import { estSlugMax } from '@/lib/pilotage-paliers'
import { COUPON_MAX_MEMBRES, corpsSessionMax, couponMax, offreMax, retourMax, type SlugOffreMax } from '@/lib/max-pur'
import { urlCheckoutSure } from '@/lib/soutien-pur'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'

/**
 * La vente du Max (27/11/2026, chantier 2026-11-27_lancement-max) : Carnet Max
 * et Duo Max (Carnet Max + Pilotage Premium), abonnement Stripe Checkout
 * HEBERGE sur le Stripe Ao Knowledge (cle de Pilotage). Route PUBLIQUE
 * (middleware.ts) : on peut payer sans compte, Checkout demande l'email.
 *
 * POST /api/max/achat
 *   Corps : { offre: 'carnet-max-mensuel' | 'carnet-max-annuel' | 'duo-max-mensuel' | 'duo-max-annuel', retour?: '/black-friday' }
 *   Bearer facultatif (jeton Supabase du site) : connecte, l'email confirme est
 *   prerempli, le compte part en client_reference_id, et le statut de membre
 *   choisit le coupon. Lu dans le jeton, jamais dans le corps.
 *   200 { ok, url, session_id, remise: 50 | 25 | 0 } : rediriger vers url (checkout.stripe.com).
 * GET /api/max/achat?offre=carnet-max-mensuel[&retour=/black-friday]
 *   Meme chose sans compte (un simple lien) : 303 vers Checkout, coupon des non-membres.
 *
 * Coupon (max-pur.ts, couponMax), pose par discounts, jamais avec
 * allow_promotion_codes : membre connecte (Live Club actif, formation longue ou
 * ETM, la regle du prix membre de l'academie, membreDuTarif) RVLTiTdv -50 % ;
 * sinon DKpZhWGh -25 % ; a partir du 01/12/2026 0 h Paris, aucun. Stripe refuse
 * le coupon (expire, supprime) : la session est recreee une fois sans coupon.
 * Apres le paiement : https://aoknowledge.com/mon-espace?max=merci ; abandon :
 * https://aoknowledge.com + retour (defaut /black-friday).
 *
 * Le droit : le webhook des abonnements (/api/pilotage/achat/webhook, source
 * 'max') pose la ligne academie_acces, l'avance a chaque renouvellement et la
 * retire a la fin de l'abonnement, avec le montant reellement paye.
 *
 * 400 'corps' | 403 'ferme' (MAX_ACHAT_FERME=1) | 409 'deja' (un Max deja actif sur ce compte)
 * 503 'membre_inconnu' (Live Club illisible, coupon en jeu) | 'config' | 'indisponible' | 502 'stripe'
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'GET, POST, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

type Issue = { ok: true; url: string; sessionId: string; remise: 50 | 25 | 0 } | { ok: false; erreur: string; status: number }

async function vendre(req: NextRequest, slug: SlugOffreMax, annulerUrl: string, avecCompte: boolean): Promise<Issue> {
  if (process.env.MAX_ACHAT_FERME?.trim() === '1') return { ok: false, erreur: 'ferme', status: 403 }

  // Un jeton refuse ou Supabase injoignable : on vend quand meme, sans compte (prix des non-membres).
  let userId: string | null = null
  let email: string | null = null
  if (avecCompte) {
    try {
      userId = await compteDuJeton(req)
      if (userId) email = await emailConfirme(userId)
    } catch (err) {
      console.warn(`[max/achat] compte illisible, vente sans compte : ${messageErreur(err)}`)
      userId = null
      email = null
    }
  }

  const maintenant = new Date()
  let membre = false
  if (userId) {
    // Jamais deux abonnements Max sur un compte : le portail client sert a changer.
    try {
      const ident = (await prisma.$queryRawUnsafe<{ emails: string[] | null }[]>(SQL_IDENTITE, userId))[0]
      const emails = [...new Set([email, ...(ident?.emails ?? [])].filter((e): e is string => Boolean(e)))]
      const actifs = await abonnementsDuMembre(userId, emails)
      if (actifs.some(a => estSlugMax(a.slug))) return { ok: false, erreur: 'deja', status: 409 }
    } catch (err) {
      console.warn(`[max/achat] base illisible (abonnements) : ${messageErreur(err)}`)
      return { ok: false, erreur: 'indisponible', status: 503 }
    }
    // Le statut de membre ne compte que tant qu'un coupon court.
    if (couponMax({ quand: maintenant, membre: true }) !== null) {
      try {
        const droits = await droitsAcademie(userId)
        membre = membreDuTarif(droits, slug, null)
        if (!membre && droits.liveClub === 'inconnu' && !membreHorsLiveClub(droits)) {
          console.warn(`[max/achat] Live Club illisible compte=${tronquer(userId)} : vente suspendue`)
          return { ok: false, erreur: 'membre_inconnu', status: 503 }
        }
      } catch (err) {
        console.warn(`[max/achat] droits illisibles compte=${tronquer(userId)} : ${messageErreur(err)}`)
        return { ok: false, erreur: 'membre_inconnu', status: 503 }
      }
    }
  }
  const coupon = couponMax({ quand: maintenant, membre })

  const cle = clePilotage()
  if (!cle) {
    console.warn('[max/achat] config absente (cle Checkout)')
    return { ok: false, erreur: 'config', status: 503 }
  }
  let prix: string | undefined
  try {
    prix = (await prixDesOffres()).get(slug)
  } catch (err) {
    console.warn(`[max/achat] base illisible : ${messageErreur(err)}`)
    return { ok: false, erreur: 'indisponible', status: 503 }
  }
  if (!prix) {
    console.warn(`[max/achat] prix Stripe absent pour ${slug} (migration des offres du Max pas appliquee)`)
    return { ok: false, erreur: 'config', status: 503 }
  }

  const corps = (c: string | null) => corpsSessionMax({ slug, prix: prix as string, annulerUrl, userId, email, coupon: c, essai: false })
  let applique = coupon
  let s: Record<string, unknown>
  try {
    try {
      s = await appeler(cle, '/v1/checkout/sessions', corps(coupon))
    } catch (err) {
      if (!coupon || !(err instanceof ErreurStripe) || err.statut !== 400 || err.permission || err.conditions) throw err
      console.warn(`[max/achat] Stripe refuse le coupon (${err.type}), session recreee sans coupon offre=${slug}`)
      applique = null
      s = await appeler(cle, '/v1/checkout/sessions', corps(null))
    }
  } catch (err) {
    if (err instanceof ErreurStripe && (err.permission || err.statut === 401)) {
      console.warn(`[max/achat] cle Stripe sans la permission Checkout Sessions (${err.statut})`)
      return { ok: false, erreur: 'config', status: 503 }
    }
    console.warn(`[max/achat] Stripe a refuse la session offre=${slug} : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return { ok: false, erreur: 'stripe', status: 502 }
  }
  const url = urlCheckoutSure(s.url)
  if (!url || typeof s.id !== 'string') return { ok: false, erreur: 'stripe', status: 502 }
  const remise = applique === null ? 0 : applique === COUPON_MAX_MEMBRES ? 50 : 25
  console.info(`[max/achat] session creee offre=${slug} compte=${userId ? tronquer(userId) : 'aucun'} remise=${remise}`)
  return { ok: true, url, sessionId: s.id, remise }
}

export async function POST(req: NextRequest) {
  const headers = { ...corsHeaders(req, METHODES), 'Cache-Control': 'no-store' }
  let corps: Record<string, unknown>
  try { corps = (await req.json()) as Record<string, unknown> } catch { corps = {} }
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) corps = {}
  const slug = offreMax(corps.offre)
  const annulerUrl = retourMax(corps.retour)
  if (!slug || !annulerUrl) return NextResponse.json({ ok: false, erreur: 'corps' }, { status: 400, headers })
  const r = await vendre(req, slug, annulerUrl, true)
  if (!r.ok) return NextResponse.json({ ok: false, erreur: r.erreur }, { status: r.status, headers })
  return NextResponse.json({ ok: true, url: r.url, session_id: r.sessionId, remise: r.remise }, { headers })
}

export async function GET(req: NextRequest) {
  const headers = { ...corsHeaders(req, METHODES), 'Cache-Control': 'no-store' }
  const q = req.nextUrl.searchParams
  const slug = offreMax(q.get('offre'))
  const annulerUrl = retourMax(q.get('retour'))
  if (!slug || !annulerUrl) return NextResponse.json({ ok: false, erreur: 'corps' }, { status: 400, headers })
  const r = await vendre(req, slug, annulerUrl, false)
  if (!r.ok) return NextResponse.json({ ok: false, erreur: r.erreur }, { status: r.status, headers })
  return NextResponse.redirect(r.url, { status: 303, headers })
}
