// Le prix d'une offre pour un compte, avec la base (20/11/2026). Regles
// pures et explications : prix-membre-pur.ts (le seul calcul du prix membre).

import { prisma } from '@/lib/db'
import { droitsAcademie } from './droits'
import { estOffreDePartie, lireTarif, membreDuTarif, prixMembre, tarifPossible, ventePartie, type PrixCalcule, type TarifMembre } from './prix-membre-pur'
import type { Droits } from './pur'
import { SQL_TARIFS_MEMBRES } from './requetes'

/** Ce que la regle du tarif lit des droits (27/11/2026 : formation longue et ETM, actuel ou ancien, en plus). */
type DroitsDuTarif = Pick<Droits, 'liveClub' | 'ouvertures'> & Partial<Pick<Droits, 'etm' | 'formationLongue' | 'aEteEtm'>>

/**
 * (28/11/2026) La vente d'une PARTIE de module, reservee aux membres du Live
 * Club (ventePartie, prix-membre-pur.ts). Lit les droits du compte seulement
 * pour une offre de partie ; illisibles : 'inconnu'. droits : rendus pour que
 * l'appelant les passe a prixDuCompte sans les relire.
 */
export async function ventePartieDuCompte(userId: string | null, offre: string): Promise<{
  decision: ReturnType<typeof ventePartie>; droits: DroitsDuTarif | null
}> {
  if (!estOffreDePartie(offre)) return { decision: 'ok', droits: null }
  if (!userId) return { decision: ventePartie({ offre, connecte: false, liveClub: null }), droits: null }
  try {
    const droits = await droitsAcademie(userId)
    return { decision: ventePartie({ offre, connecte: true, liveClub: droits.liveClub }), droits }
  } catch (err) {
    console.warn(`[academie/prix-membre] droits illisibles, vente de partie suspendue offre=${offre} : ${err instanceof Error ? err.name : 'erreur'}`)
    return { decision: 'inconnu', droits: null }
  }
}

/** Tous les tarifs membres en base (passes compris). Leve si la base est illisible ou la migration absente (42703). */
export async function lireTarifsMembres(): Promise<TarifMembre[]> {
  const lignes = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(SQL_TARIFS_MEMBRES)
  return lignes.map(lireTarif).filter((t): t is TarifMembre => t !== null)
}

/**
 * Le prix d'une offre pour un compte, a un moment : prixMembre, avec les
 * tarifs de la base et les droits du compte (lus seulement si un tarif de
 * l'offre vaut a ce moment). Sans compte : le prix courant. droits : deja
 * lus par l'appelant (/moi), sinon droitsAcademie. Leve si les tarifs sont
 * illisibles : a l'appelant de choisir (prix courant ou refus). Droits
 * illisibles (27/11/2026) : incertain, comme un Live Club inconnu.
 */
export async function prixDuCompte(p: {
  userId: string | null
  offre: string
  prixCourantEur: number
  quand?: Date
  tarifs?: readonly TarifMembre[]
  droits?: DroitsDuTarif
}): Promise<PrixCalcule & { incertain: boolean }> {
  const quand = p.quand ?? new Date()
  const courant = { prixEur: p.prixCourantEur, prixCourantEur: p.prixCourantEur, tarif: null, incertain: false }
  if (!p.userId) return courant
  const tarifs = (p.tarifs ?? (await lireTarifsMembres())).filter(t => t.cible === p.offre)
  if (!tarifPossible(p.offre, tarifs, quand)) return courant
  // (27/11/2026, correctif des bonus membres) Un tarif vaut mais les droits du compte sont illisibles : incertain (la
  // route ne vend pas, achatAVerifier), plus une exception que l'achat par carte rattrapait au prix plein, en silence.
  let droits: DroitsDuTarif
  try {
    droits = p.droits ?? (await droitsAcademie(p.userId))
  } catch (err) {
    console.warn(`[academie/prix-membre] droits illisibles, statut membre inconnu offre=${p.offre} : ${err instanceof Error ? err.name : 'erreur'}`)
    return { ...courant, incertain: true }
  }
  const moduleId = tarifs.find(t => t.moduleId)?.moduleId ?? null
  // (20/11/2026) Une regle par tarif : une partie garde celle de la partie 2, un module entier demande le Live Club actif.
  const calcul = prixMembre({ offre: p.offre, prixCourantEur: p.prixCourantEur, membre: membreDuTarif(droits, p.offre, moduleId), tarifs, quand })
  // incertain : un tarif vaut, mais le Live Club du compte est illisible (Stripe) ; il compte alors comme non membre.
  return { ...calcul, incertain: !calcul.tarif && droits.liveClub === 'inconnu' }
}
