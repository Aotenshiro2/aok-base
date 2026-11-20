// Le prix d'une offre pour un compte, avec la base (20/11/2026). Regles
// pures et explications : prix-membre-pur.ts (le seul calcul du prix membre).

import { prisma } from '@/lib/db'
import { droitsAcademie } from './droits'
import { lireTarif, membreDuModule, prixMembre, tarifPossible, type PrixCalcule, type TarifMembre } from './prix-membre-pur'
import type { Droits } from './pur'
import { SQL_TARIFS_MEMBRES } from './requetes'

/** Tous les tarifs membres en base (passes compris). Leve si la base est illisible ou la migration absente (42703). */
export async function lireTarifsMembres(): Promise<TarifMembre[]> {
  const lignes = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(SQL_TARIFS_MEMBRES)
  return lignes.map(lireTarif).filter((t): t is TarifMembre => t !== null)
}

/**
 * Le prix d'une offre pour un compte, a un moment : prixMembre, avec les
 * tarifs de la base et les droits du compte (lus seulement si un tarif de
 * l'offre vaut a ce moment). Sans compte : le prix courant. droits : deja
 * lus par l'appelant (/moi), sinon droitsAcademie. Leve si la base ou les
 * droits sont illisibles : a l'appelant de choisir (prix courant ou refus).
 */
export async function prixDuCompte(p: {
  userId: string | null
  offre: string
  prixCourantEur: number
  quand?: Date
  tarifs?: readonly TarifMembre[]
  droits?: Pick<Droits, 'liveClub' | 'ouvertures'>
}): Promise<PrixCalcule & { incertain: boolean }> {
  const quand = p.quand ?? new Date()
  const courant = { prixEur: p.prixCourantEur, prixCourantEur: p.prixCourantEur, tarif: null, incertain: false }
  if (!p.userId) return courant
  const tarifs = (p.tarifs ?? (await lireTarifsMembres())).filter(t => t.cible === p.offre)
  if (!tarifPossible(p.offre, tarifs, quand)) return courant
  const droits = p.droits ?? (await droitsAcademie(p.userId))
  const moduleId = tarifs.find(t => t.moduleId)?.moduleId ?? null
  const calcul = prixMembre({ offre: p.offre, prixCourantEur: p.prixCourantEur, membre: membreDuModule(droits, moduleId), tarifs, quand })
  // incertain : un tarif vaut, mais le Live Club du compte est illisible (Stripe) ; il compte alors comme non membre.
  return { ...calcul, incertain: !calcul.tarif && droits.liveClub === 'inconnu' }
}
