// LES CARTES A BOUTONS ENVOYEES A PLUSIEURS COMPTES DE L'EQUIPE (21/11/2026,
// Brice : « ça serait bien que moi, je ne sois pas laissé en suspens sur la
// question de l'agent »). Une carte part a chaque compte de l'equipe (Agent
// AOK) ; quand l'un d'eux repond, les cartes des AUTRES se ferment : plus de
// boutons, et une ligne dit ce qui a ete decide, par qui et quand. Regles et
// textes ici (sans base ni reseau), l'envoi et la fermeture dans
// cartes-equipe.ts. Premier usage : la carte des lots (liveclub/lots.ts).
// Le mecanisme suit celui des propositions de Tab (tab/repondre.ts, clore),
// qui le faisait deja pour ses propres cartes.

/** Une carte partie : le chat (compte de l'equipe) et le message, pour la fermer apres la decision. */
export type CarteEquipe = { chat: number; message: number }

const entierPositif = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

/** Les cartes gardees dans un champ JSON (details de la declaration...). Tout ce qui est illisible est ecarte. */
export function lireCartesEquipe(brut: unknown): CarteEquipe[] {
  if (!Array.isArray(brut)) return []
  const vues = new Set<string>()
  const cartes: CarteEquipe[] = []
  for (const c of brut) {
    if (!c || typeof c !== 'object') continue
    const { chat, message } = c as Record<string, unknown>
    if (!entierPositif(chat) || !entierPositif(message)) continue
    const cle = `${chat}:${message}`
    if (vues.has(cle)) continue
    vues.add(cle)
    cartes.push({ chat, message })
  }
  return cartes
}

/** Le message_id rendu par sendMessage, ou null. */
export function messageIdEnvoye(resultat: unknown): number | null {
  const id = resultat && typeof resultat === 'object' ? (resultat as { message_id?: unknown }).message_id : null
  return entierPositif(id) ? id : null
}

/**
 * Les cartes a fermer apres une decision : toutes celles qui sont parties,
 * SAUF celle sur laquelle on vient de cliquer (elle garde son propre
 * traitement), sans doublon.
 */
export function cartesAFermer(cartes: CarteEquipe[], cliquee: { chat: number; message: number | null } | null): CarteEquipe[] {
  return lireCartesEquipe(cartes).filter(c => !(cliquee && c.chat === cliquee.chat && c.message === cliquee.message))
}

const PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** « le 20/11 à 14 h 02 », heure de Paris. null si la date est illisible. */
export function momentParis(d: Date | string | number | null | undefined): string | null {
  if (d === null || d === undefined) return null
  const t = d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d)
  if (!Number.isFinite(t)) return null
  const p = Object.fromEntries(PARIS.formatToParts(new Date(t)).map(x => [x.type, x.value]))
  return `le ${p.day}/${p.month} à ${p.hour} h ${p.minute}`
}

/** Le nom de l'equipe tel que le compte le porte (libelle), ou « quelqu'un de l'équipe ». */
export function nomDecideur(par: string | null | undefined): string {
  const s = typeof par === 'string' ? par.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  return s || "quelqu'un de l'équipe"
}

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * La ligne de fin d'une carte decidee.
 * - oui : « Validé par Mel, le 20/11 à 14 h 02 : lots notés faits. »
 * - non : « Mel a répondu non, le 20/11 à 14 h 02. » (avec `quoi` : « ... : lots pas encore vus. »)
 * Sans date lisible, la date est omise ; sans nom, « quelqu'un de l'équipe ».
 */
export function ligneDecisionEquipe(o: { verbe: 'oui' | 'non'; par: string | null | undefined; le: Date | string | number | null | undefined; quoi?: string | null }): string {
  const qui = nomDecideur(o.par)
  const quand = momentParis(o.le)
  const suite = o.quoi ? ` : ${o.quoi}.` : '.'
  if (o.verbe === 'oui') return `Validé par ${qui}${quand ? `, ${quand}` : ''}${suite}`
  return `${majuscule(qui)} a répondu non${quand ? `, ${quand}` : ''}${suite}`
}

/** Le texte d'une carte fermee : la carte, puis la ligne de fin, dans les 4 096 caracteres d'un message. */
export function texteCarteFermee(carte: string, fin: string): string {
  const t = `${carte}\n\n${fin}`
  return t.length <= 4096 ? t : `${carte.slice(0, Math.max(0, 4096 - fin.length - 6))}...\n\n${fin}`
}

/**
 * Un refus de Telegram a l'edition : 'deja' (la carte est deja dans cet etat,
 * rien a faire), 'perdue' (message trop ancien, supprime, introuvable,
 * compte qui a bloque le bot : on ne peut plus la fermer), 'autre'.
 */
export function classerRefusEdition(description: string): 'deja' | 'perdue' | 'autre' {
  const d = description.toLowerCase()
  if (d.includes('message is not modified')) return 'deja'
  if (/message to edit not found|message can't be edited|message_id_invalid|chat not found|bot was blocked|user is deactivated|forbidden/.test(d)) return 'perdue'
  return 'autre'
}
