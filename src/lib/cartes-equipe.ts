// LES CARTES A BOUTONS ENVOYEES A PLUSIEURS COMPTES DE L'EQUIPE, cote serveur
// (21/11/2026 ; regles et textes dans cartes-equipe-pur.ts) :
// - envoyerCarteEquipe : la carte a UN compte, par Agent AOK ; rend le
//   message parti ({ chat, message }) pour pouvoir la fermer plus tard ;
// - fermerCartesEquipe : APRES une decision deja ecrite, les cartes des
//   autres comptes passent au texte « carte + ligne de fin », sans boutons.
//   Un echec (message trop ancien, supprime, bot bloque) se note dans le log,
//   sans identifiant ni texte, et ne remonte jamais : la decision est prise,
//   rien ne l'annule. Un clic tardif sur une carte restee ouverte est rattrape
//   par celui qui la traite (« deja decide par ... »).
// Ne jette jamais.

import { tgCockpitAppel } from '@/lib/agent-cockpit-telegram'
import { classerRefusEdition, messageIdEnvoye, texteCarteFermee, type CarteEquipe } from '@/lib/cartes-equipe-pur'

/** La carte a un compte de l'equipe. null = rien n'est parti. */
export async function envoyerCarteEquipe(
  chat: number, texte: string, clavier: { text: string; callback_data: string }[][],
): Promise<{ chat: number; message: number | null } | null> {
  const r = await tgCockpitAppel('sendMessage', { chat_id: chat, text: texte, reply_markup: { inline_keyboard: clavier } })
  if (!r.ok) return null
  // Parti mais sans message_id lisible (message: null) : la carte compte comme livree, elle ne pourra pas etre fermee d'ici.
  return { chat, message: messageIdEnvoye(r.resultat) }
}

export type BilanFermeture = { fermees: number; perdues: number; autres: number }

/**
 * Ferme des cartes (boutons retires, ligne de fin). `carte` = le texte de la
 * carte tel qu'il est parti (le meme pour tous) ; null = on ne le connait
 * plus : seuls les boutons sont retires. `journal` prefixe le log.
 */
export async function fermerCartesEquipe(
  cartes: CarteEquipe[], o: { carte: string | null; fin: string; journal: string },
): Promise<BilanFermeture> {
  const bilan: BilanFermeture = { fermees: 0, perdues: 0, autres: 0 }
  for (const c of cartes) {
    if (!Number.isSafeInteger(c.message) || c.message <= 0) continue
    try {
      const r = o.carte
        ? await tgCockpitAppel('editMessageText', {
          chat_id: c.chat, message_id: c.message, text: texteCarteFermee(o.carte, o.fin),
          reply_markup: { inline_keyboard: [] }, link_preview_options: { is_disabled: true },
        })
        : await tgCockpitAppel('editMessageReplyMarkup', { chat_id: c.chat, message_id: c.message, reply_markup: { inline_keyboard: [] } })
      if (r.ok) { bilan.fermees++; continue }
      const genre = classerRefusEdition(r.description)
      if (genre === 'deja') bilan.fermees++
      else if (genre === 'perdue') bilan.perdues++
      else bilan.autres++
    } catch {
      bilan.autres++
    }
  }
  if (bilan.perdues + bilan.autres > 0) {
    console.warn(`${o.journal} : ${bilan.fermees}/${cartes.length} carte(s) fermee(s), ${bilan.perdues} introuvable(s) ou bloquee(s), ${bilan.autres} autre(s) refus`)
  }
  return bilan
}
