// La reprise de la progression des membres de Skool (15/11/2026, carte 382) :
// la base seulement. Les regles, la correspondance des cours et les requetes
// sont dans reprise-pur.ts ; la route est src/app/api/academie/reprise/route.ts,
// /moi rend l'etat du bouton et les reperes (src/app/api/academie/moi/route.ts).
//
// Ce qu'une reprise ecrit (une transaction) : la ligne du journal
// academie_reprises D'ABORD (l'index unique tient le « une fois », deux clics
// simultanes n'en passent qu'un), puis les lecons (vu_par = 'reprise', jamais
// terminee_le ni marquee_vue_le : aucun point, aucun temps de visionnage,
// aucun email ni notification : rien ne reagit a vu_le), puis la liste des
// lecons reellement cochees dans la ligne du journal.
// Jamais d'email ni de nom dans les logs : le compte tronque et des nombres.

import { prisma } from '@/lib/db'
import type { Catalogue } from './catalogue'
import { ouvertureLecon, type Droits } from './pur'
import {
  REPRISE_UNE_FOIS_PAR, REPRISES_PAR_HEURE, SQL_COCHER_REPRISE, SQL_COMPLETER_REPRISE, SQL_FAITS_REPRISE, SQL_POSER_REPRISE,
  SQL_RELEVE_DU_COMPTE, SQL_REPRISES_DU_COMPTE, SQL_REPRISES_HEURE, etatReprise, planReprise, reperesSkool,
  type EtatReprise, type LeconPourReprise, type LigneReleveCompte, type RefusReprise, type Repere, type RepriseFaite,
} from './reprise-pur'
import type { ProgressionLecon } from './suivi'

type LigneFaits = { releve_skool: boolean; ancien: boolean; arrivee: Date | null; maintenant: Date }
type LigneReleve = { skool_cours_id: string; skool_cours_titre: string; lecons_terminees: number; lecons_total: number; releve_le: string }
type LigneReprise = { module_id: string; section_id: string | null; mode: 'membre' | 'equipe' }

export type SituationReprise = {
  etat: EtatReprise
  faites: RepriseFaite[]
  releve: LigneReleveCompte[]
}

/** Ce que la base sait du compte pour la reprise. Jette sur une panne (tables absentes comprises). */
export async function situationReprise(userId: string): Promise<SituationReprise> {
  const [faits, releve, faites] = await Promise.all([
    prisma.$queryRawUnsafe<LigneFaits[]>(SQL_FAITS_REPRISE, userId),
    prisma.$queryRawUnsafe<LigneReleve[]>(SQL_RELEVE_DU_COMPTE, userId),
    prisma.$queryRawUnsafe<LigneReprise[]>(SQL_REPRISES_DU_COMPTE, userId),
  ])
  const f = faits[0]
  return {
    etat: etatReprise({
      releveSkool: f?.releve_skool === true,
      ancien: f?.ancien === true,
      arrivee: f?.arrivee ?? null,
      maintenant: f?.maintenant ?? new Date(),
    }),
    faites: faites.map(r => ({ moduleId: r.module_id, sectionId: r.section_id, mode: r.mode })),
    releve: releve.map(r => ({
      skoolCoursId: r.skool_cours_id,
      skoolCoursTitre: r.skool_cours_titre,
      leconsTerminees: Number(r.lecons_terminees) || 0,
      leconsTotal: Number(r.lecons_total) || 0,
      releveLe: r.releve_le,
    })),
  }
}

/** Les reperes « Sur Skool : x % » du compte, par cible (module:<id>, section:<id>). */
export function reperesDuCompte(s: SituationReprise, catalogue: Catalogue): Map<string, Repere> {
  return reperesSkool(s.releve, catalogue)
}

/** Le repere tel que la page le recoit (null = aucun pourcentage importe pour cette cible). */
export function reperePublic(r: Repere | undefined) {
  return r ? { pourcentage: r.pourcentage, terminees: r.terminees, total: r.total, releve_le: r.releveLe } : null
}

/**
 * Ce que /moi rend : le bouton (possible = historique ET dans la fenetre) et
 * ce qui est deja utilise. Sans historique : possible et historique faux, la
 * page ne montre rien. Jamais la source de l'historique ni le releve brut.
 */
export function vueReprise(s: SituationReprise) {
  return {
    possible: s.etat.ouverte,
    historique: s.etat.historique,
    jusquau: s.etat.jusquau?.toISOString() ?? null,
    une_fois_par: REPRISE_UNE_FOIS_PAR,
    faites: s.faites.filter(f => f.mode === 'membre').map(f => ({ module_id: f.moduleId, section_id: f.sectionId })),
  }
}

/** Les lecons d'un module, jugees pour la reprise (memes droits que /moi). */
export function leconsPourReprise(
  catalogue: Catalogue, droits: Droits, progression: Map<string, ProgressionLecon>, moduleId: string, modulePublie: boolean,
): LeconPourReprise[] {
  return catalogue.lecons
    .filter(l => l.moduleId === moduleId)
    .map(l => {
      const r = ouvertureLecon(droits, l)
      return {
        id: l.id,
        sectionId: l.sectionId,
        lisible: modulePublie && l.statut === 'publie',
        acces: r.acces,
        raisons: r.raisons,
        vue: progression.get(l.id)?.etat === 'vu',
      }
    })
}

export type IssueReprise =
  | { issue: 'refus'; refus: RefusReprise | 'limite' }
  | { issue: 'ok'; lecons: string[]; dejaVues: number; portee: 'module' | 'section' }

/**
 * Une reprise du compte sur un module ou une section. La route a deja lu le
 * jeton ; ici : la decision (planReprise), le garde-fou par heure, puis
 * l'ecriture. Jette sur une panne de base.
 */
export async function reprendre(p: {
  userId: string
  moduleId: string
  sectionId: string | null
  catalogue: Catalogue
  droits: Droits
  progression: Map<string, ProgressionLecon>
  situation: SituationReprise
}): Promise<IssueReprise> {
  const m = p.catalogue.modules.find(x => x.id === p.moduleId) ?? null
  const plan = planReprise({
    etat: p.situation.etat,
    faites: p.situation.faites,
    module: m ? { id: m.id, publie: m.statut === 'publie', externe: Boolean(m.lienExterne) } : null,
    sectionId: p.sectionId,
    sections: p.catalogue.sections.filter(s => s.moduleId === p.moduleId).map(s => s.id),
    lecons: m ? leconsPourReprise(p.catalogue, p.droits, p.progression, m.id, m.statut === 'publie') : [],
  })
  if ('refus' in plan) return { issue: 'refus', refus: plan.refus }

  const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(SQL_REPRISES_HEURE, p.userId)
  if (n >= REPRISES_PAR_HEURE) return { issue: 'refus', refus: 'limite' }

  const reperes = reperesDuCompte(p.situation, p.catalogue)
  const repere = reperes.get(p.sectionId ? `section:${p.sectionId}` : `module:${p.moduleId}`)

  return prisma.$transaction(async tx => {
    const poses = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_POSER_REPRISE,
      p.userId, p.moduleId, p.sectionId, plan.portee, plan.verrou, plan.dejaVues, repere?.pourcentage ?? null)
    if (!poses[0]) return { issue: 'refus' as const, refus: 'deja' as const }
    const cochees = await tx.$queryRawUnsafe<{ lecon_id: string }[]>(SQL_COCHER_REPRISE, p.userId, plan.lecons)
    const ids = cochees.map(c => c.lecon_id)
    await tx.$executeRawUnsafe(SQL_COMPLETER_REPRISE, poses[0].id, ids)
    return { issue: 'ok' as const, lecons: ids, dejaVues: plan.dejaVues + (plan.lecons.length - ids.length), portee: plan.portee }
  }, { timeout: 10_000 })
}
