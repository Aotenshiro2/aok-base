import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiErrorMessage } from '@/lib/ai'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { boucleEspace, executeurDuCompte } from '@/lib/agent-espace'
import { analyserTexte, rendreVisible } from '@/lib/securite/injection-pur'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import type Anthropic from '@anthropic-ai/sdk'

// (28/11/2026) L'agent du cockpit en MODE BRIDE (chantier espace-adrien) : pour un compte du niveau
// d'acces restreint (cockpit_niveaux), et pour l'apercu « voir comme » d'un membre du cockpit.
//
// Le garde :
//   - Bearer obligatoire (pas de cookie) : le jeton part tel quel vers la base a chaque outil ;
//   - cockpit_niveau() = 'animateur' (lu avec CE jeton) : son propre espace, `apercu` ignore ;
//   - sinon `apercu` doit etre dans espace_apercus() lu avec CE jeton (vide pour qui n'est pas membre).
// Aucune autre lecture : pas de prisma, pas de cle service. Pas de piece jointe dans ce mode.

export const maxDuration = 60

const MAX_HISTORY = 16
const MAX_MESSAGE_LEN = 2000

type MessageEntrant = { role?: unknown; content?: unknown }

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors: Record<string, string> = corsHeaders(req)
  const auth = req.headers.get('authorization')
  const jeton = auth?.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!jeton) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const executer = executeurDuCompte(jeton)
  // Le compte : getUser par la base d'auth, avec ce jeton.
  const sbAuth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await sbAuth.auth.getUser(jeton)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const body = await req.json().catch(() => ({}))

  let apercu: string | null = null
  const niveau = await executer('cockpit_niveau', {})
  if (niveau.data !== 'animateur') {
    const demande = typeof body.apercu === 'string' ? body.apercu.trim().slice(0, 60) : ''
    if (!demande) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers: cors })
    const liste = await executer('espace_apercus', {})
    const noms = Array.isArray(liste.data) ? (liste.data as { intervenant?: unknown }[]).map((r) => String(r.intervenant ?? '')) : []
    const trouve = noms.find((n) => n.toLowerCase() === demande.toLowerCase())
    if (!trouve) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers: cors })
    apercu = trouve
  }

  const brut: MessageEntrant[] = Array.isArray(body.messages) ? body.messages : []
  const historique: Anthropic.MessageParam[] = []
  for (const m of brut.slice(-MAX_HISTORY)) {
    if (m?.role !== 'user' && m?.role !== 'assistant') continue
    const texte = typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_LEN).trim() : ''
    if (!texte) continue
    historique.push({ role: m.role, content: texte })
  }
  if (historique.length === 0 || historique[historique.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Message manquant' }, { status: 400, headers: cors })
  }

  // Securite des bots (29/10) : ce que tape le titulaire. Suspect = rendu visible pour le modele et
  // Brice prevenu. Ce mode n'a de toute facon aucun geste ni aucune carte.
  const dernier = historique[historique.length - 1]
  const analyse = analyserTexte(String(dernier.content), { niveau: 'cache' })
  if (analyse.suspect) {
    dernier.content = rendreVisible(String(dernier.content))
    await alerterBriceSecurite({
      source: apercu ? `Agent AOK, espace restreint (aperçu ${apercu})` : 'Agent AOK, espace restreint',
      qui: user.email ?? user.id, analyse,
      suite: 'Mode bridé : aucun outil d’écriture ; le texte suspect a été rendu visible au modèle.',
    })
  }

  try {
    const reponse = await boucleEspace(historique, {
      userId: user.id, apercu, executer, signal: AbortSignal.timeout((maxDuration - 5) * 1000),
    })
    return NextResponse.json(reponse, { headers: cors })
  } catch (err) {
    console.error('[cockpit/agent-espace]', err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : '?')
    return NextResponse.json({ error: aiErrorMessage(err, 'ANTHROPIC_API_KEY_COCKPIT') }, { status: 502, headers: cors })
  }
}
