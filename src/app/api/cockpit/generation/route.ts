import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireDemandeGeneration } from '@/lib/generation-pur'
import { genererPost } from '@/lib/generation'
import { accesCreationCockpit, brouillonDe } from '@/lib/acces-creation-cockpit'

/**
 * POST /api/cockpit/generation : l'ecran Generation de l'onglet Creation du
 * cockpit (19/10/2026). Ecrit un brouillon de post dans la voix de Brice ou
 * de Mel, a partir d'une idee, d'une capture (image en base64, gardee reduite depuis le
 * 20/10, cf. generation-capture.ts) ou des deux (le sens se deduit de l'image), le range dans cockpit_generations et le
 * rend. Regenerer et retoucher passent par la meme route (parent_id, et
 * consigne pour une retouche). Rien n'est publie : le brouillon se
 * copie-colle, la note (publie tel quel, retouche, jete) s'ecrit depuis
 * l'ecran (grant update de la table).
 *
 * Garde : jeton Supabase en Bearer + allowlist du cockpit par UUID, comme
 * /api/cockpit/creation. Etre authentifie ne prouve rien.
 * (28/11/2026) Le niveau d'acces restreint (cockpit_niveaux) y entre aussi : il ne repart que de
 * SES brouillons (parent_id, image_de) et la reponse ne porte pas de cout (cout_micros).
 */

export const maxDuration = 300

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const acces = await accesCreationCockpit(userId)
  if (!acces) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  const demande = lireDemandeGeneration(await req.json().catch(() => null))
  if (typeof demande === 'string') return NextResponse.json({ error: demande }, { status: 400, headers })

  if (acces === 'niveau') {
    for (const id of [demande.parent_id, demande.image_de]) {
      if (id && !(await brouillonDe(id, userId))) {
        return NextResponse.json({ error: 'Ce brouillon n\'est pas le tien.' }, { status: 403, headers })
      }
    }
  }

  const r = await genererPost(demande, userId, 'cockpit')
  if (!r.ok) return NextResponse.json({ error: r.erreur }, { status: r.status, headers })
  return NextResponse.json(
    acces === 'niveau'
      ? { ok: true, id: r.id, contenu: r.contenu, envoyees: r.envoyees, image_chemin: r.image_chemin }
      : { ok: true, id: r.id, contenu: r.contenu, envoyees: r.envoyees, cout_micros: r.cout_micros, image_chemin: r.image_chemin },
    { headers },
  )
}
