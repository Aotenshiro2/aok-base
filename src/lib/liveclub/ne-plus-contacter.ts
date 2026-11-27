// NE PLUS CONTACTER (Brice, 27/11/2026) : la partie SERVEUR. La regle, les
// textes et la decision : ne-plus-contacter-pur.ts.
//
// Le marqueur est une ligne du journal du bot (public.cockpit_liveclub_gestes) :
// geste 'rappel', resultat 'fait', regle REGLE_NE_PLUS_CONTACTER, acteur
// 'bot:membre'. C'est EXACTEMENT ce que lit le lanceur des envois aux anciens
// (bf-anciens.ts, lireEtatAncien : exists ... geste = 'rappel' and regle =
// 'ne_plus_contacter' and resultat = 'fait'). Aucune migration.
//
// Qui lit le marqueur : les envois a NOTRE initiative seulement (conseils
// d'accueil du passage, lanceur bf-anciens). Jamais les reponses du bot, ni
// l'entree dans le groupe, ni l'indicateur, ni une reprise d'abonnement.

import { prisma } from '@/lib/db'
import { messageErreur } from './pur'
import { tracerEtape } from './support-pont'
import { REGLE_NE_PLUS_CONTACTER, detailsMarqueur } from './ne-plus-contacter-pur'

/** ACTEUR_BOT_MEMBRE (actions-membre.ts), recopie pour ne pas tirer ce module dans le passage. */
const ACTEUR_BOT_MEMBRE = 'bot:membre'

/** La ligne du fil Support (cockpit) quand le marqueur est pose. */
export const ETAPE_NE_PLUS_CONTACTER = 'Ne veut plus recevoir nos messages : noté (plus de promos ni de relances de notre part).'

/** Le marqueur est-il pose ? null = base illisible (l'appelant n'envoie rien dans le doute). */
export async function nePlusContacterPose(telegramId: number): Promise<boolean | null> {
  try {
    const lignes = await prisma.$queryRaw<{ pose: boolean }[]>`
      select exists (
        select 1 from public.cockpit_liveclub_gestes g
        where g.telegram_id = ${telegramId}::bigint and g.geste = 'rappel'
          and g.regle = ${REGLE_NE_PLUS_CONTACTER} and g.resultat = 'fait') as pose`
    return lignes[0]?.pose === true
  } catch (err) {
    console.warn(`[liveclub/ne-plus-contacter] marqueur illisible pour u${telegramId} : ${messageErreur(err)}`)
    return null
  }
}

/**
 * Pose le marqueur, une fois (deja pose = 'deja', rien de plus). Le texte de
 * la personne n'est jamais recopie dans le journal (il est deja dans son fil).
 * Ne jette pas : 'panne' si la base refuse.
 */
export async function poserNePlusContacter(
  telegramId: number,
  origine: 'agent' | 'non_rattache',
): Promise<'pose' | 'deja' | 'panne'> {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return 'panne'
  try {
    const details = detailsMarqueur(origine, new Date())
    const lignes = await prisma.$queryRaw<{ geste_id: bigint }[]>`
      insert into public.cockpit_liveclub_gestes (telegram_id, geste, resultat, acteur, regle, details)
      select ${telegramId}::bigint, 'rappel', 'fait', ${ACTEUR_BOT_MEMBRE}, ${REGLE_NE_PLUS_CONTACTER}, ${JSON.stringify(details)}::jsonb
      where not exists (
        select 1 from public.cockpit_liveclub_gestes g
        where g.telegram_id = ${telegramId}::bigint and g.geste = 'rappel'
          and g.regle = ${REGLE_NE_PLUS_CONTACTER} and g.resultat = 'fait')
      returning geste_id`
    if (!lignes[0]) return 'deja'
    await tracerEtape(telegramId, ETAPE_NE_PLUS_CONTACTER).catch(() => undefined)
    return 'pose'
  } catch (err) {
    console.warn(`[liveclub/ne-plus-contacter] marqueur non pose pour u${telegramId} : ${messageErreur(err)}`)
    return 'panne'
  }
}
