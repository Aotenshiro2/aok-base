import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { jetonDeLaRequete } from '@/lib/academie/pur'
import {
  cadencePassage, entetesPassage, passage, TYPE_PASSAGE,
  type ComptePassage, type JetonSupabase,
} from '@/lib/masterclass-passage-pur'

/**
 * POST /api/masterclass/passage : le passage connecte d'aoknowledge.com vers
 * le tunnel du replay (masterclass.aoknowledge.com/live-ouvert, 27/11/2026).
 * Le site l'appelle au clic sur « Regarder le replay » quand le membre est
 * connecte, puis ouvre /live-ouvert?de=...#token_hash=...&type=recovery ; la
 * masterclass appelle verifyOtp({ token_hash, type }) et efface le fragment.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, sans corps.
 * Le compte est TOUJOURS celui du jeton : la route ne lit aucune adresse
 * envoyee par la page, et ne cree jamais de compte (generateLink 'recovery',
 * qui n'envoie aucun email). Logique dans masterclass-passage-pur.ts.
 *
 * Reponses :
 *   200 { ok: true, token_hash, type: 'recovery' }
 *   401 'jeton'          jeton absent ou refuse
 *   403 'origine'        appel hors de aoknowledge.com (et du dev local)
 *   403 'compte'         compte anonyme, sans adresse, ou adresse non confirmee
 *   429 'limite'         10 passages par 10 minutes et par compte (Retry-After)
 *   502 'generation'     Supabase n'a pas rendu de jeton (ou un jeton pour un autre compte)
 *   503 'config' | 'indisponible'
 * La page retombe sur le lien simple (le tunnel des visiteurs) a tout refus.
 *
 * Cadence : tenue EN MEMOIRE de l'instance (comme /api/carnet/diagnostic) ;
 * une instance froide ou une autre instance repart de zero. Un plafond strict
 * entre instances demanderait une table (non ecrite).
 *
 * Jamais le jeton, le token_hash ni l'adresse dans un log. Cache-Control: no-store.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const PREFIXE = '[masterclass/passage]'

// userId -> instants des passages rendus (voir « Cadence » ci-dessus).
const passagesParCompte = new Map<string, number[]>()

function reserver(userId: string): number {
  const maintenant = Date.now()
  if (passagesParCompte.size > 500) {
    for (const [cle, liste] of passagesParCompte) {
      if (cadencePassage(liste, maintenant).recents.length === 0) passagesParCompte.delete(cle)
    }
  }
  const c = cadencePassage(passagesParCompte.get(userId) ?? [], maintenant)
  if (!c.autorise) return c.reessayerDansMs
  // Reserve AVANT la generation : deux clics rapproches comptent deux fois.
  passagesParCompte.set(userId, [...c.recents, maintenant])
  return 0
}

let admin: SupabaseClient | null = null
function clientAdmin(): SupabaseClient | null {
  if (admin) return admin
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return null
  admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  return admin
}

/** Le code ou le nom de l'erreur : jamais son message. */
function codeErreur(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { status?: unknown; code?: unknown; name?: unknown }
  const morceaux = [e.status, e.code].filter(x => typeof x === 'number' || typeof x === 'string').map(String)
  if (morceaux.length) return morceaux.join(' ')
  return typeof e.name === 'string' ? e.name : 'erreur'
}

async function compte(jeton: string): Promise<ComptePassage | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await supabase.auth.getUser(jeton)
  if (error) {
    // 4xx = jeton refuse (expire, faux, compte supprime) : 401 a la page.
    // Le reste (Supabase injoignable) : 503.
    if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) return null
    throw error
  }
  const u = data.user
  if (!u) return null
  return { userId: u.id, email: u.email ?? null, confirme: Boolean(u.email_confirmed_at), anonyme: Boolean(u.is_anonymous) }
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: entetesPassage(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const headers = entetesPassage(origin)
  const client = clientAdmin()
  if (!client || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.warn(`${PREFIXE} config incomplete : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY`)
    return NextResponse.json({ ok: false, erreur: 'config' }, { status: 503, headers })
  }

  const r = await passage(origin, jetonDeLaRequete(req.headers.get('authorization')), {
    compte,
    reserver,
    async genererJeton(email): Promise<JetonSupabase> {
      const { data, error } = await client.auth.admin.generateLink({ type: TYPE_PASSAGE, email })
      if (error || !data?.user || !data.properties?.hashed_token) {
        return { ok: false, erreur: error ? `supabase ${error.status ?? ''} ${error.code ?? error.name}`.trim() : 'reponse vide' }
      }
      return { ok: true, userId: data.user.id, tokenHash: data.properties.hashed_token, type: data.properties.verification_type }
    },
    journal: (ligne) => console.info(`${PREFIXE} ${ligne}`),
    codeErreur,
  })
  return NextResponse.json(r.corps, {
    status: r.status,
    headers: r.reessayerDans ? { ...headers, 'Retry-After': String(r.reessayerDans) } : headers,
  })
}
