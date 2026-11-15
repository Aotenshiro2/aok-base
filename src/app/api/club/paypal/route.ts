import { NextRequest, NextResponse } from 'next/server'
import { clientIdPayPal, configPayPal, ventePublique } from '@/lib/academie/club-paypal'
import { offrePayPal } from '@/lib/academie/club-paypal-pur'
import { corsAcademie, entetesAcademie, refusAcademie } from '@/lib/academie/http'

/**
 * GET /api/club/paypal : ce que la page /club demande avant de charger le JS
 * SDK de PayPal (29/10/2026). Route PUBLIQUE (middleware.ts).
 *
 * ?offre=coaching (08/11/2026) : la meme question pour le coaching de 8 h de
 * /merci. Sans parametre : le 10% Club, comme avant. ?offre=smt (14/11/2026) :
 * le module Smart Money Technique, sur sa page de l'academie.
 * ?offre=smt-partie-1 ou smt-partie-2 (15/11/2026) : une partie de ce module
 * vendue seule, sur la meme page.
 *
 * 200 { ok, client_id, ouvert, offre } : client_id est public (il est dans
 *     l'adresse du SDK) ; ouvert = la vente publique de l'offre (CLUB_PAYPAL_PUBLIC,
 *     COACHING_PAYPAL_PUBLIC, SMT_PAYPAL_PUBLIC, SMT_PARTIE_1_PAYPAL_PUBLIC ou
 *     SMT_PARTIE_2_PAYPAL_PUBLIC vaut 1 ; sinon seul l'essai admin passe) ;
 *     offre = l'offre comprise (une cle de OFFRES_PAYPAL). Les
 *     pages du coaching et du module exigent leur offre en retour : un journal
 *     plus ancien, qui ne la connait pas, ne leur fait jamais vendre le Club a
 *     sa place.
 * 400 'offre' : offre inconnue. 503 'config' : PAYPAL_CLIENT_ID ou PAYPAL_CLIENT_SECRET absent.
 */

export const dynamic = 'force-dynamic'

const METHODES = 'GET, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const offre = offrePayPal(req.nextUrl.searchParams.get('offre') ?? undefined)
  if (!offre) return refusAcademie('offre', 400, headers)
  const clientId = clientIdPayPal()
  if (!configPayPal() || !clientId) {
    console.warn('[club/paypal] config absente (PAYPAL_CLIENT_ID ou PAYPAL_CLIENT_SECRET)')
    return refusAcademie('config', 503, headers)
  }
  return NextResponse.json({ ok: true, client_id: clientId, ouvert: ventePublique(offre.cle), offre: offre.cle }, { headers })
}
