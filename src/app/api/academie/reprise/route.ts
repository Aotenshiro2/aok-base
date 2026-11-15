import { NextRequest, NextResponse } from 'next/server'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireCatalogue, type Catalogue } from '@/lib/academie/catalogue'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { CacheCourt } from '@/lib/academie/pur'
import { reprendre, situationReprise, type IssueReprise, type SituationReprise } from '@/lib/academie/reprise'
import { ECART_REPRISE_MS, lireDemandeReprise } from '@/lib/academie/reprise-pur'
import { progressionDuCompte, type ProgressionLecon } from '@/lib/academie/suivi'
import { relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/reprise : le bouton « Deja vu avant » (15/11/2026, carte
 * 382 ; src/lib/academie/reprise-pur.ts, migration 20261115180000).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, corps
 *   { module: <id du module>, section?: <id de la section> }
 * Le SERVEUR decide (cacher le bouton ne suffit pas), dans l'ordre :
 *   1. le compte (jeton) ;
 *   2. l'historique : au moins une lecon terminee dans le releve de Skool du
 *      15/11 pour un membre de Skool rattache au compte (adresse verifiee non
 *      ambigue, ou rattachement de l'equipe), ou ancien membre IziTrade ou
 *      LearnyBox ;
 *   3. la fenetre : REPRISE_JOURS jours apres l'arrivee dans l'academie, au
 *      plus tot a partir de REPRISE_DEPUIS ;
 *   4. une fois par cours (REPRISE_UNE_FOIS_PAR), tenu aussi par la base ;
 *   5. les droits : seulement les lecons PUBLIEES de la cible que le compte a
 *      pour de vrai (pas un apercu ni le billet du jour), et pas deja vues.
 * Puis la ligne du journal academie_reprises et les lecons (vu_par =
 * 'reprise' : ni points, ni temps de visionnage, ni email, ni notification).
 *
 * Reponses :
 *   200 { ok: true, lecons: [ids cochees], deja_vues, portee }
 *   400 'demande' ; 401 'jeton' ;
 *   403 'historique' | 'delai' | 'acces' ;
 *   404 'module' | 'section' ;
 *   409 'deja' (deja utilise pour ce cours) | 'vide' (tout est deja vu : rien n'est consomme) ;
 *   429 'debit' (un appel par compte toutes les 3 s) | 'limite' (20 reprises par heure) ;
 *   503 'indisponible' (base, Supabase Auth, migration pas appliquee, ou droit Live Club illisible).
 *
 * Logs : compte tronque, issue, nombre de lecons. Jamais d'email ni de nom.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const STATUTS: Readonly<Record<string, number>> = {
  historique: 403, delai: 403, acces: 403, module: 404, section: 404, deja: 409, vide: 409, limite: 429, inconnu: 503,
}

// Un appel par compte toutes les ECART_REPRISE_MS, par instance (le « une fois » et la limite par heure sont en base).
const derniersAppels = new CacheCourt<true>(2000)

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/reprise] verification du jeton impossible : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  const corps: unknown = await req.json().catch(() => ({}))
  const demande = lireDemandeReprise(corps)
  if (!demande) return refus('demande', 400)

  if (derniersAppels.lire(userId)) return refus('debit', 429)
  derniersAppels.ecrire(userId, true, ECART_REPRISE_MS)

  let catalogue: Catalogue
  let droits: DroitsAcademie
  let progression: Map<string, ProgressionLecon>
  let situation: SituationReprise
  try {
    [catalogue, droits, progression, situation] = await Promise.all([
      lireCatalogue(), droitsAcademie(userId), progressionDuCompte(userId), situationReprise(userId),
    ])
  } catch (err) {
    console.warn(`[academie/reprise] lecture impossible compte=${tronquer(userId)} : ${
      relationAbsente(err) ? 'tables absentes (migration 20261115180000 pas appliquee ?)' : codeErreur(err)}`)
    return refus('indisponible', 503)
  }

  let issue: IssueReprise
  try {
    issue = await reprendre({ userId, moduleId: demande.module, sectionId: demande.section, catalogue, droits, progression, situation })
  } catch (err) {
    console.warn(`[academie/reprise] reprise NON faite compte=${tronquer(userId)} : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }

  if (issue.issue === 'refus') {
    console.info(`[academie/reprise] refus compte=${tronquer(userId)} module=${tronquer(demande.module)} : ${issue.refus}`)
    const statut = STATUTS[issue.refus] ?? 400
    return refus(statut === 503 ? 'indisponible' : issue.refus, statut)
  }
  console.info(`[academie/reprise] faite compte=${tronquer(userId)} module=${tronquer(demande.module)} ${issue.portee} : ${
    issue.lecons.length} lecon(s) cochee(s), ${issue.dejaVues} deja vue(s)`)
  return NextResponse.json({ ok: true, lecons: issue.lecons, deja_vues: issue.dejaVues, portee: issue.portee }, { headers })
}

/** Le code de l'erreur (Prisma, Postgres) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}
