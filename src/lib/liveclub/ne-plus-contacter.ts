// NE PLUS CONTACTER (Brice, 27/11/2026) : la partie SERVEUR. La regle, les
// textes et la decision : ne-plus-contacter-pur.ts.
//
// Le marqueur est une ligne du journal du bot (public.cockpit_liveclub_gestes) :
// geste 'rappel', resultat 'fait', regle REGLE_NE_PLUS_CONTACTER, acteur
// 'bot:membre'. La LEVEE (Brice, 27/11 : « si la personne redemande des
// messages, il faut lui renvoyer ») est une ligne de plus, jamais une
// suppression : meme geste et resultat, regle REGLE_NE_PLUS_CONTACTER_LEVE.
// L'ETAT COURANT = la derniere des deux (fait_le, puis geste_id) :
// sqlNePlusContacter, le meme calcul qu'etatCourantNePlusContacter (pur).
//
// Le lanceur des envois aux anciens (branche bf-anciens, lireEtatAncien) doit
// lire cet etat courant (sqlNePlusContacter), plus le simple « exists ».
//
// Qui lit le marqueur : les envois a NOTRE initiative seulement (conseils
// d'accueil du passage, lanceur bf-anciens). Jamais les reponses du bot, ni
// l'entree dans le groupe, ni l'indicateur, ni une reprise d'abonnement.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { messageErreur } from './pur'
import { tracerEtape } from './support-pont'
import { REGLE_NE_PLUS_CONTACTER, REGLE_NE_PLUS_CONTACTER_LEVE, detailsMarqueur } from './ne-plus-contacter-pur'

/** ACTEUR_BOT_MEMBRE (actions-membre.ts), recopie pour ne pas tirer ce module dans le passage. */
const ACTEUR_BOT_MEMBRE = 'bot:membre'

/** Les lignes du fil Support (cockpit) a la pose et a la levee. */
export const ETAPE_NE_PLUS_CONTACTER = 'Ne veut plus recevoir nos messages : noté (plus de promos ni de relances de notre part).'
export const ETAPE_REPRISE_MESSAGES = 'Veut de nouveau recevoir nos messages : marqueur levé.'

/**
 * L'etat courant, en SQL (booleen, vrai = marque) : la derniere ligne pose ou
 * levee de la personne. A coller dans un select ou un where (passage, lanceur).
 */
export function sqlNePlusContacter(telegramId: number): Prisma.Sql {
  return Prisma.sql`coalesce((
      select e.regle = ${REGLE_NE_PLUS_CONTACTER} from public.cockpit_liveclub_gestes e
      where e.telegram_id = ${telegramId}::bigint and e.geste = 'rappel' and e.resultat = 'fait'
        and e.regle in (${REGLE_NE_PLUS_CONTACTER}, ${REGLE_NE_PLUS_CONTACTER_LEVE})
      order by e.fait_le desc, e.geste_id desc
      limit 1), false)`
}

/** Le marqueur est-il pose (etat courant) ? null = base illisible (l'appelant n'envoie rien dans le doute). */
export async function nePlusContacterPose(telegramId: number): Promise<boolean | null> {
  try {
    const lignes = await prisma.$queryRaw<{ pose: boolean }[]>`select ${sqlNePlusContacter(telegramId)} as pose`
    return lignes[0]?.pose === true
  } catch (err) {
    console.warn(`[liveclub/ne-plus-contacter] marqueur illisible pour u${telegramId} : ${messageErreur(err)}`)
    return null
  }
}

/**
 * Ecrit la pose (marque = false avant) ou la levee (marque = true avant), sous
 * un verrou par personne : deux messages simultanes n'ecrivent qu'une ligne.
 * 'deja' = l'etat voulu est deja l'etat courant, rien d'ecrit.
 */
async function ecrire(
  telegramId: number, regle: string, attendu: boolean, details: Record<string, unknown>,
): Promise<'ecrit' | 'deja'> {
  const lignes = await prisma.$transaction(async tx => {
    await tx.$queryRaw`
      select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:ne_plus_contacter:${telegramId}`}::text, 0))) as verrou`
    return tx.$queryRaw<{ geste_id: bigint }[]>`
      insert into public.cockpit_liveclub_gestes (telegram_id, geste, resultat, acteur, regle, details)
      select ${telegramId}::bigint, 'rappel', 'fait', ${ACTEUR_BOT_MEMBRE}, ${regle}, ${JSON.stringify(details)}::jsonb
      where ${sqlNePlusContacter(telegramId)} = ${attendu}
      returning geste_id`
  })
  return lignes[0] ? 'ecrit' : 'deja'
}

/**
 * Pose le marqueur si l'etat courant n'est pas deja « marque » (apres une
 * levee, il se repose). Le texte de la personne n'est jamais recopie dans le
 * journal (il est deja dans son fil). Ne jette pas : 'panne' si la base refuse.
 */
export async function poserNePlusContacter(
  telegramId: number,
  origine: 'agent' | 'non_rattache',
): Promise<'pose' | 'deja' | 'panne'> {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return 'panne'
  try {
    const issue = await ecrire(telegramId, REGLE_NE_PLUS_CONTACTER, false, detailsMarqueur(origine, new Date()))
    if (issue === 'deja') return 'deja'
    await tracerEtape(telegramId, ETAPE_NE_PLUS_CONTACTER).catch(() => undefined)
    return 'pose'
  } catch (err) {
    console.warn(`[liveclub/ne-plus-contacter] marqueur non pose pour u${telegramId} : ${messageErreur(err)}`)
    return 'panne'
  }
}

/**
 * Leve le marqueur si l'etat courant est « marque » ('pas_marque' sinon : rien
 * a changer). Une ligne de plus, aucune suppression. Ne jette pas.
 */
export async function leverNePlusContacter(
  telegramId: number,
  origine: 'agent' | 'non_rattache',
): Promise<'leve' | 'pas_marque' | 'panne'> {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return 'panne'
  try {
    const issue = await ecrire(telegramId, REGLE_NE_PLUS_CONTACTER_LEVE, true, detailsMarqueur(origine, new Date()))
    if (issue === 'deja') return 'pas_marque'
    await tracerEtape(telegramId, ETAPE_REPRISE_MESSAGES).catch(() => undefined)
    return 'leve'
  } catch (err) {
    console.warn(`[liveclub/ne-plus-contacter] marqueur non leve pour u${telegramId} : ${messageErreur(err)}`)
    return 'panne'
  }
}
