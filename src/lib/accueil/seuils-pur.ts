// Accueil des acheteurs : les seuils qui disent si un acheteur « decroche »
// (decision de Brice du 14/11/2026, option A : garder ces seuils, a revoir
// apres le premier mois avec les vrais chiffres). Messages et variantes :
// D:\6_Societe\Pilotage\Data-Performance\marketing\accueil-2026\ (01, 03, 04).
//
// Regles pures, sans base ni reseau (scripts/verifier-accueil-seuils.mjs).
// La lecture en base est dans ./mesure.ts.
//
// Un jour ou l'academie est ouverte compte une fois (decision du 11/11), jour
// pris a l'heure de Paris. Les jours d'un jalon partent du jour de l'achat
// inclus : le J14 regarde les 14 jours de l'achat a la veille du J+14, et ne
// peut se lire qu'a partir du J+14. Avant, c'est « trop tot ». Lu plus tard
// (envoi en retard), la fenetre reste la meme : on ne compte que ces 14 jours.

import { OFFRE_CLUB, OFFRE_SMT_PARTIE_2 } from '../academie/club-paypal-pur'

export type OffreAccueil = 'trader-autonome' | 'forfait-live-club' | 'partie-2'
export type MesureAccueil = 'jours_ouverts' | 'lecons_lues'
export type EtatAccueil = 'decroche' | 'avance' | 'trop_tot'

export type SeuilAccueil = {
  offre: OffreAccueil
  /** Le jour du message (J+n apres l'achat) et la taille de la fenetre lue. */
  jalon: number
  mesure: MesureAccueil
  /** Au moins ce nombre = « avance » ; en dessous = « decroche ». */
  minimum: number
  /** Saison ou le seuil sert d'abord (priorite de l'Orchestre Marketing, 20/11). */
  sert: 'black-friday' | 'noel'
  /** Le message qui lit ce seuil. */
  message: string
}

/**
 * LA table des seuils : la seule chose a changer apres le premier mois.
 * Ordre = priorite : les deux seuils du Black Friday d'abord (forfaits J25,
 * vers le 22/12 ; partie 2 J30, vers le 27/12), ceux de la formation a Noel.
 */
export const SEUILS_ACCUEIL: readonly SeuilAccueil[] = [
  { offre: 'forfait-live-club', jalon: 25, mesure: 'jours_ouverts', minimum: 4, sert: 'black-friday', message: '03-forfaits, J25 (contact de Mel)' },
  { offre: 'partie-2', jalon: 30, mesure: 'lecons_lues', minimum: 5, sert: 'black-friday', message: '04-partie-2, J30 (point d usage)' },
  { offre: 'partie-2', jalon: 7, mesure: 'lecons_lues', minimum: 5, sert: 'black-friday', message: '04-partie-2, J7 (se tait s il avance)' },
  { offre: 'trader-autonome', jalon: 14, mesure: 'jours_ouverts', minimum: 3, sert: 'noel', message: '01-trader-autonome, J14' },
  { offre: 'trader-autonome', jalon: 30, mesure: 'jours_ouverts', minimum: 4, sert: 'noel', message: '01-trader-autonome, J30 (point d usage)' },
]

/**
 * L'offre de l'academie dont l'acces (academie_acces.debut) donne la date
 * d'achat, et dont le perimetre compte les lecons lues. Les forfaits du Live
 * Club n'ont pas d'offre a l'academie : leur date de debut vient de l'appelant.
 */
export const OFFRE_ACADEMIE: Record<OffreAccueil, string | null> = {
  'trader-autonome': OFFRE_CLUB,
  'forfait-live-club': null,
  'partie-2': OFFRE_SMT_PARTIE_2,
}

export function seuilAccueil(offre: OffreAccueil, jalon: number): SeuilAccueil | null {
  return SEUILS_ACCUEIL.find(s => s.offre === offre && s.jalon === jalon) ?? null
}

const JOUR_MS = 24 * 3600 * 1000
const FORMAT_PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Le jour calendaire a Paris, 'AAAA-MM-JJ'. */
export function jourParis(d: Date): string {
  return FORMAT_PARIS.format(d)
}

/** 'AAAA-MM-JJ' + n jours (calendaire, sans fuseau). */
export function ajouterJours(jour: string, n: number): string {
  const t = Date.parse(`${jour}T00:00:00.000Z`)
  if (!Number.isFinite(t)) throw new Error(`jour invalide : ${jour}`)
  return new Date(t + n * JOUR_MS).toISOString().slice(0, 10)
}

/** La fenetre lue par un jalon : du jour de l'achat inclus au jour du jalon exclu (jours de Paris). */
export function fenetreAccueil(seuil: Pick<SeuilAccueil, 'jalon'>, achatLe: Date): { debut: string; finExclue: string } {
  const debut = jourParis(achatLe)
  return { debut, finExclue: ajouterJours(debut, seuil.jalon) }
}

/** Le jalon est-il atteint (aujourd'hui, a Paris, est au moins le J+jalon) ? */
export function jalonAtteint(seuil: Pick<SeuilAccueil, 'jalon'>, achatLe: Date, maintenant: Date): boolean {
  return jourParis(maintenant) >= fenetreAccueil(seuil, achatLe).finExclue
}

/**
 * La regle : « trop_tot » avant le jour du jalon, puis « avance » si la mesure
 * atteint le minimum, sinon « decroche ». `valeur` = la mesure du seuil
 * (jours ouverts ou lecons lues) comptee dans fenetreAccueil.
 */
export function etatAccueil(p: { seuil: SeuilAccueil; achatLe: Date; maintenant: Date; valeur: number }): EtatAccueil {
  if (!jalonAtteint(p.seuil, p.achatLe, p.maintenant)) return 'trop_tot'
  return p.valeur >= p.seuil.minimum ? 'avance' : 'decroche'
}
