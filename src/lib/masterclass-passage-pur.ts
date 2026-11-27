// Le passage connecte d'aoknowledge.com vers le tunnel du replay (27/11/2026,
// demande de Brice) : un membre deja connecte sur le site qui clique
// « Regarder le replay » arrive connecte sur masterclass.aoknowledge.com/live-ouvert,
// sans redonner son email. Les deux sites partagent le projet Supabase mais pas
// la session (un domaine chacun) : la route POST /api/masterclass/passage rend,
// au compte du jeton Bearer, un token_hash que la masterclass passe a
// verifyOtp({ token_hash, type }). Meme mecanique que le lien magique du cockpit
// (cockpit-lien-magique-pur.ts) : generateLink 'recovery', qui ne cree jamais de
// compte et n'envoie aucun email.
//
// Fonctions PURES (aucune base, aucun reseau, aucun alias d'import) :
// scripts/verifier-masterclass-passage.mjs les teste avec Node seul.

/** Le type du jeton Supabase : 'recovery' et rien d'autre (sur une adresse inconnue, une erreur, jamais un compte cree). */
export const TYPE_PASSAGE = 'recovery'

/** Cadence par compte : 10 passages par 10 minutes (un membre clique une fois ; au-dela, ce n'est plus un clic). */
export const PASSAGES_MAX = 10
export const FENETRE_PASSAGES_MS = 10 * 60 * 1000

// Le site seulement (pas les autres sous-domaines : ils n'ont pas de bouton
// vers le tunnel), et le dev local comme les autres routes.
const ORIGINES = new Set(['https://aoknowledge.com', 'https://www.aoknowledge.com'])
const LOCAL = /^http:\/\/localhost(:\d+)?$/

export function origineAutorisee(origin: string | null): boolean {
  return Boolean(origin && (ORIGINES.has(origin) || LOCAL.test(origin)))
}

/** CORS de la route (rien pour une origine hors liste) et jamais de cache : la reponse porte un jeton. */
export function entetesPassage(origin: string | null): Record<string, string> {
  const base: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (!origin || !origineAutorisee(origin)) return base
  return {
    ...base,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Les passages recents d'un compte, et s'il en reste un. */
export function cadencePassage(
  instants: readonly number[],
  maintenant: number,
  max = PASSAGES_MAX,
  fenetreMs = FENETRE_PASSAGES_MS,
): { autorise: boolean; recents: number[]; reessayerDansMs: number } {
  const recents = instants.filter(t => t > maintenant - fenetreMs && t <= maintenant)
  if (recents.length < max) return { autorise: true, recents, reessayerDansMs: 0 }
  const plusAncien = Math.min(...recents)
  return { autorise: false, recents, reessayerDansMs: Math.max(1000, plusAncien + fenetreMs - maintenant) }
}

/** Le compte du jeton, tel que Supabase Auth le rend (getUser). */
export type ComptePassage = {
  userId: string
  email: string | null
  /** email_confirmed_at present */
  confirme: boolean
  anonyme: boolean
}

export type JetonSupabase =
  | { ok: true; userId: string; tokenHash: string; type: string }
  | { ok: false; erreur: string }

export type ReponsePassage = {
  status: number
  corps: { ok: true; token_hash: string; type: typeof TYPE_PASSAGE } | { ok: false; erreur: string }
  /** Secondes avant de reessayer (429). */
  reessayerDans?: number
}

export type DependancesPassage = {
  /** Le compte du jeton, null si Supabase le refuse (4xx). Jette si Supabase est injoignable. */
  compte(jeton: string): Promise<ComptePassage | null>
  /** Reserve un passage pour ce compte ; rend le delai d'attente en ms si la cadence est depassee, 0 sinon. */
  reserver(userId: string): number
  /** generateLink 'recovery' pour cette adresse (n'envoie rien). */
  genererJeton(email: string): Promise<JetonSupabase>
  journal(ligne: string): void
  codeErreur(err: unknown): string
}

const refus = (erreur: string, status: number, reessayerDans?: number): ReponsePassage =>
  ({ status, corps: { ok: false, erreur }, ...(reessayerDans ? { reessayerDans } : {}) })

/**
 * Le passage : origine du site, jeton valide, compte avec une adresse
 * confirmee, cadence, puis le jeton Supabase de CE compte. Ne jette pas.
 * Les lignes du journal ne portent que les 8 premiers caracteres du compte :
 * jamais l'adresse, le jeton Bearer ni le token_hash.
 */
export async function passage(origin: string | null, jeton: string | null, d: DependancesPassage): Promise<ReponsePassage> {
  if (!origineAutorisee(origin)) return refus('origine', 403)
  if (!jeton) return refus('jeton', 401)

  let c: ComptePassage | null
  try {
    c = await d.compte(jeton)
  } catch (err) {
    d.journal(`verification du jeton impossible : ${d.codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!c) return refus('jeton', 401)
  const cid = c.userId.slice(0, 8)

  // Un compte anonyme, sans adresse ou a l'adresse jamais confirmee ne passe pas :
  // le jeton 'recovery' confirmerait une adresse que personne n'a prouvee.
  if (c.anonyme || !c.email || !c.confirme) {
    d.journal(`compte=${cid} : refuse (${c.anonyme ? 'anonyme' : !c.email ? 'sans adresse' : 'adresse non confirmee'})`)
    return refus('compte', 403)
  }

  const attente = d.reserver(c.userId)
  if (attente > 0) {
    d.journal(`compte=${cid} : cadence depassee`)
    return refus('limite', 429, Math.ceil(attente / 1000))
  }

  let j: JetonSupabase
  try {
    j = await d.genererJeton(c.email)
  } catch (err) {
    j = { ok: false, erreur: d.codeErreur(err) }
  }
  if (!j.ok) {
    d.journal(`compte=${cid} : generation impossible (${j.erreur})`)
    return refus('generation', 502)
  }
  if (j.userId.toLowerCase() !== c.userId.toLowerCase() || j.type !== TYPE_PASSAGE || !j.tokenHash) {
    // Ne doit jamais arriver : le jeton viserait un autre compte. On ne le rend pas.
    d.journal(`compte=${cid} : jeton REFUSE (compte ${j.userId.slice(0, 8)}, type ${j.type})`)
    return refus('generation', 502)
  }
  d.journal(`compte=${cid} : jeton rendu`)
  return { status: 200, corps: { ok: true, token_hash: j.tokenHash, type: TYPE_PASSAGE } }
}
