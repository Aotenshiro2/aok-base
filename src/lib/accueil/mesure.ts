// Accueil des acheteurs : le point d'accroche ou les messages d'accueil
// (mail de Brice J14 / J30, contact de Mel J25, mails de la partie 2) liront
// l'etat de l'acheteur, juste avant l'envoi (01-trader-autonome : « si l'etat
// n'est pas lisible au moment de l'envoi, le message ne part pas »).
//
// Aucune nouvelle mesure : on lit ce que l'academie note deja (suivi.ts).
//   - jours ouverts = jours de Paris distincts avec au moins une ligne dans
//     academie_lectures (connexion, lien, lecture, texte...), un jour = une fois ;
//   - lecons lues = lecons du perimetre de l'offre (academie_offre_contenus :
//     module entier ou section) passees « vu » dans la fenetre, sans les
//     reprises de Skool (vu_par 'reprise' : rien n'a ete lu ici).
// Lecture seule. Rien n'est envoye d'ici.

import { prisma } from '@/lib/db'
import {
  OFFRE_ACADEMIE, etatAccueil, fenetreAccueil, seuilAccueil,
  type EtatAccueil, type OffreAccueil, type SeuilAccueil,
} from './seuils-pur'

/** $1 user_id, $2 premier jour (inclus), $3 jour de fin (exclu), jours de Paris 'AAAA-MM-JJ'. */
export const SQL_JOURS_OUVERTS = `
select count(distinct (l.cree_le at time zone 'Europe/Paris')::date)::int as n
  from public.academie_lectures l
 where l.user_id = $1::uuid
   and l.cree_le >= ($2::date::timestamp at time zone 'Europe/Paris')
   and l.cree_le <  ($3::date::timestamp at time zone 'Europe/Paris')`

/** $1 user_id, $2 premier jour, $3 jour de fin (exclu), $4 slug de l'offre. */
export const SQL_LECONS_LUES = `
select count(*)::int as n
  from public.academie_progression g
  join public.academie_lecons c on c.id = g.lecon_id
 where g.user_id = $1::uuid
   and g.vu_le is not null
   and g.vu_par is distinct from 'reprise'
   and g.vu_le >= ($2::date::timestamp at time zone 'Europe/Paris')
   and g.vu_le <  ($3::date::timestamp at time zone 'Europe/Paris')
   and exists (
     select 1
       from public.academie_offre_contenus oc
       join public.academie_offres o on o.id = oc.offre_id
      where o.slug = $4
        and oc.module_id = c.module_id
        and (oc.section_id is null or oc.section_id = c.section_id))`

/** $1 user_id, $2 slug de l'offre : le premier acces non retire (date d'achat). */
export const SQL_DEBUT_ACCES = `
select min(a.debut) as debut
  from public.academie_acces a
  join public.academie_offres o on o.id = a.offre_id
 where a.user_id = $1::uuid
   and o.slug = $2
   and a.retire_le is null`

export type LectureAccueil =
  | {
      etat: EtatAccueil
      seuil: SeuilAccueil
      achatLe: Date
      fenetre: { debut: string; finExclue: string }
      /** Pour les variables des mails ({{ jours_ouverts }}, {{ lecons_lues }}) et le choix de variante. */
      joursOuverts: number
      /** null quand l'offre n'a pas de perimetre a l'academie (forfaits du Live Club). */
      leconsLues: number | null
    }
  | { etat: 'illisible'; raison: 'seuil_inconnu' | 'achat_introuvable' | 'panne' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * L'etat d'accueil d'un acheteur pour une offre et un jalon (J14, J25, J30...).
 * `userId` = le compte du site (uuid Supabase). `achatLe` : la date d'achat si
 * l'appelant la connait (obligatoire pour les forfaits du Live Club, qui n'ont
 * pas d'acces a l'academie) ; sinon le premier acces a l'offre est relu.
 * Ne jette pas : une panne ou un achat introuvable rend « illisible », et le
 * message ne part pas.
 */
export async function lireEtatAccueil(p: {
  userId: string
  offre: OffreAccueil
  jalon: number
  maintenant?: Date
  achatLe?: Date
}): Promise<LectureAccueil> {
  const seuil = seuilAccueil(p.offre, p.jalon)
  if (!seuil) return { etat: 'illisible', raison: 'seuil_inconnu' }
  if (!UUID.test(p.userId)) return { etat: 'illisible', raison: 'achat_introuvable' }
  const maintenant = p.maintenant ?? new Date()
  const slug = OFFRE_ACADEMIE[p.offre]
  try {
    let achatLe = p.achatLe ?? null
    if (!achatLe && slug) {
      const l = await prisma.$queryRawUnsafe<{ debut: Date | null }[]>(SQL_DEBUT_ACCES, p.userId, slug)
      achatLe = l[0]?.debut ?? null
    }
    if (!achatLe || Number.isNaN(achatLe.getTime())) return { etat: 'illisible', raison: 'achat_introuvable' }

    const fenetre = fenetreAccueil(seuil, achatLe)
    const jours = await prisma.$queryRawUnsafe<{ n: number }[]>(SQL_JOURS_OUVERTS, p.userId, fenetre.debut, fenetre.finExclue)
    const joursOuverts = jours[0]?.n ?? 0
    let leconsLues: number | null = null
    if (slug) {
      const lecons = await prisma.$queryRawUnsafe<{ n: number }[]>(SQL_LECONS_LUES, p.userId, fenetre.debut, fenetre.finExclue, slug)
      leconsLues = lecons[0]?.n ?? 0
    }
    if (seuil.mesure === 'lecons_lues' && leconsLues === null) return { etat: 'illisible', raison: 'seuil_inconnu' }
    const valeur = seuil.mesure === 'jours_ouverts' ? joursOuverts : (leconsLues as number)
    return { etat: etatAccueil({ seuil, achatLe, maintenant, valeur }), seuil, achatLe, fenetre, joursOuverts, leconsLues }
  } catch (e) {
    console.warn(`[accueil/mesure] lecture impossible (${p.offre} J${p.jalon}) :`, e instanceof Error ? e.message : e)
    return { etat: 'illisible', raison: 'panne' }
  }
}
