// NE PLUS CONTACTER (Brice, 27/11/2026). Module PUR (aucun import) : la regle,
// les textes et la decision. Teste par scripts/verifier-ne-plus-contacter.mjs.
//
// Brice, 27/11 : « je ne souhaite pas que le bot propose par un bouton de
// lui-meme "je souhaite me desabonner". C'est juste que si la personne, par
// ecrit, emane l'envie de se desabonner ou de ne pas etre contactee, le bot
// sache le reconnaitre, mais pas qu'il lui propose. Attention, ne pas etre
// contacte ne veut pas dire etre exclu du Live Club. »
//
// Donc :
// - aucun bouton, aucune proposition, aucune mention spontanee ;
// - une demande NETTE ecrite par la personne pose le marqueur et le bot le
//   confirme en une phrase (TEXTE_NE_PLUS_CONTACTER_NOTE) ;
// - « me desabonner », « me desinscrire », « stop » seul : UNE question de doute
//   (QUESTION_DOUTE_NE_PLUS_CONTACTER), rien n'est pose avant la reponse ;
//   « mon abonnement » = la demande d'arret habituelle (proposer_arret) ;
// - une duree (« pas avant lundi, je suis en vacances ») ou un autre service
//   (« le broker ne m'envoie plus ses mails ») : rien, le bot repond normalement ;
// - le marqueur ne coupe QUE les envois a notre initiative (promos, relances
//   d'anciens, conseils d'accueil) ; le bot repond toujours, l'acces au groupe
//   et a l'indicateur ne change pas, une reprise d'abonnement est normale.
//
// LE MARQUEUR, lu tel quel par le lanceur des envois aux anciens (branche
// bf-anciens, src/lib/liveclub/bf-anciens.ts, lireEtatAncien) : une ligne de
// public.cockpit_liveclub_gestes avec geste = 'rappel', regle =
// REGLE_NE_PLUS_CONTACTER, resultat = 'fait', telegram_id = la personne
// (acteur 'bot:membre', details { origine, demande_le }). Aucune migration :
// 'rappel' et une regle libre sont deja permis.

/** La regle du journal du bot (geste 'rappel', resultat 'fait'). La MEME constante que bf-anciens-pur.ts. */
export const REGLE_NE_PLUS_CONTACTER = 'ne_plus_contacter'

/** L'outil de l'agent membre (prompt-membre.ts). */
export const NOM_OUTIL_NE_PLUS_CONTACTER = 'ne_plus_contacter'

/** La confirmation, une phrase d'etat : ce qui touche son abonnement continue (prelevement, pause, sortie). */
export const TEXTE_NE_PLUS_CONTACTER_NOTE = "C'est noté : plus de messages de ma part, sauf ce qui touche ton abonnement. Tu peux toujours m'écrire ici, je te réponds."

/** La question de doute, une seule fois. */
export const QUESTION_DOUTE_NE_PLUS_CONTACTER = 'Tu veux arrêter ton abonnement, ou ne plus recevoir nos messages ?'

/** Le marqueur n'a pas pu etre ecrit (base illisible) : rien n'est promis. */
export const TEXTE_NE_PLUS_CONTACTER_PANNE = "Je n'arrive pas à le noter pour le moment. Réécris-le moi dans un moment, ou passe par l'équipe avec le bouton."

export type DecisionNePlusContacter =
  /** Demande nette : poser le marqueur, confirmer. */
  | { type: 'poser' }
  /** Reponse « les deux » a la question : poser le marqueur, puis l'arret habituel. */
  | { type: 'poser_et_abonnement' }
  /** Pas net : la question de doute, rien de pose. */
  | { type: 'doute' }
  /** Il parle de son abonnement : l'arret habituel, rien de pose. */
  | { type: 'abonnement' }
  /** Une duree, un autre service, une reponse floue, ou rien de tel : rien, reponse normale. */
  | { type: 'rien'; motif: 'temporaire' | 'autre_service' | 'reponse_floue' | 'pas_de_demande' | 'trop_long' }

/** Minuscules, sans accents, apostrophes droites, espaces simples. */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim()
}

// Une duree ou un moment : la demande n'est pas « plus jamais ».
const TEMPORAIRE = /\b(avant|jusqu'?(a|au|aux)|d'ici|pendant|vacances?|conges?|cette semaine|ce soir|ce week-?end|aujourd'hui|demain|pour (le moment|l'instant|quelques|un temps|un moment|l'heure)|quelques (jours|semaines|heures)|en ce moment|\d+ ?(h|heures?|jours?|semaines?|mois)|la semaine prochaine|le mois prochain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|temporairement|provisoirement|momentanement)\b/

// Un autre service que nous est nomme : peut-etre pas a nous qu'il parle de ne
// plus ecrire (« je ne veux plus recevoir les mails de Vantage »). Jamais le
// marqueur ; la question de doute si l'agent y a vu une demande.
const AUTRE_SERVICE = /\b(broker|courtier|vantage|ftmo|prop ?firms?|stripe|paypal|banque|tradingview|skool|discord|whatsapp|instagram|youtube|tiktok|metricgram|google|apple)\b/

// Le debut d'une demande : debut du message, d'une phrase, ou une formule de demande.
const DEBUT = String.raw`(?:^|[.!?,;:]\s*|\b(?:merci de|stp|svp|s'il te plait|s'il vous plait|tu peux|vous pouvez|peux-tu|pouvez-vous|pourriez-vous|je veux|je voudrais|j'aimerais|je souhaite|je souhaiterais|je prefere|et|alors|donc|ok|bon)\s+)`
const NET = [
  // « ne me contacte plus », « ne m'envoyez plus rien », « ne m'ecris plus »
  new RegExp(`${DEBUT}ne (?:me |m'|nous )(?:re)?(?:contact|ecri|envoi|envoy|relanc|sollicit|spam)\\w* plus`),
  // « merci de ne plus me contacter », « ne plus m'envoyer de messages »
  new RegExp(`${DEBUT}ne plus (?:me |m'|nous )(?:re)?(?:contacter|ecrire|envoyer|relancer|solliciter|spammer)`),
  // « je ne veux plus etre contacte », « je veux plus recevoir vos promos », « je ne souhaite pas etre relance »
  /\bje (?:ne |n')?(?:veux|souhaite|voudrais|desire|tiens) (?:pas|plus) (?:a )?(?:etre (?:re)?(?:contacte|relance|sollicite|spamme)|recevoir (?:de |vos |tes |ces |les |aucun )?(?:messages?|promos?|offres?|relances?|pubs?|publicites?|notifications?|mails?|sms)|(?:de |d')(?:messages?|promos?|offres?|relances?|pubs?|publicites?|sollicitations?)|que (?:tu|vous) (?:me |m')(?:re)?(?:contact|ecri|envoi|envoy|relanc|sollicit))/,
  // « je ne veux plus de vos messages »
  /\bje (?:ne |n')?(?:veux|souhaite) plus (?:de )?(?:vos|tes|ces) (?:messages?|promos?|offres?|relances?|pubs?)/,
  // « arrete de m'ecrire », « arretez de me relancer »
  new RegExp(`${DEBUT}arrete[sz]? de (?:me |m')(?:contacter|ecrire|envoyer|relancer|spammer|solliciter)`),
  // « ne plus etre contacte », « il ne faut plus me contacter »
  new RegExp(`${DEBUT}ne plus etre (?:re)?(?:contacte|relance|sollicite)`),
  /\bil ne faut plus (?:me |m')(?:re)?(?:contacter|ecrire|envoyer|relancer|solliciter)/,
  // « plus de messages svp », ou seul dans le message
  /\bplus (?:de|aucun|aucune) (?:messages?|promos?|relances?|pubs?|offres?)(?: de (?:ta|votre) part)? (?:svp|stp|merci|s'il (?:te|vous) plait)\b/,
  /^(?:svp |stp )?plus (?:de|aucun|aucune) (?:messages?|promos?|relances?|pubs?)(?: de (?:ta|votre) part)?(?: svp| stp| merci)?\s*[.!]*$/,
]

// Pas net : la question de doute.
const AMBIGU = /(d[e]?sabonn|d[e]?sinscri|unsubscribe|^stop\s*[.!]*$|laisse[sz]?[- ]moi tranquille|desactiv\w* (?:les |tes |vos )?(?:notif|messages))/

// Ce qui parle de l'abonnement lui-meme.
const ABONNEMENT = /\b(abonnement|abo|resili\w*|live ?club|du groupe|le groupe|prelevement|paiement|payer)\b/
// Ce qui parle des messages.
const MESSAGES = /\b(messages?|mails?|promos?|pubs?|publicites?|relances?|notifications?|notifs?|contact\w*|recevoir|sollicitations?)\b/

/** Le dernier message du bot est-il la question de doute ? */
export function estQuestionDoute(dernierBot: string | null | undefined): boolean {
  return typeof dernierBot === 'string' && normaliser(dernierBot).includes(normaliser(QUESTION_DOUTE_NE_PLUS_CONTACTER))
}

/** La reponse de la personne a la question de doute. */
export function reponseAuDoute(texte: string): 'messages' | 'abonnement' | 'les_deux' | 'flou' {
  const t = normaliser(texte)
  if (/\bles (deux|2)\b|\b(tout|les 2)\s*[.!]*$/.test(t)) return 'les_deux'
  const m = MESSAGES.test(t) || /^(le |la )?(2|deuxieme|second|seconde)\b/.test(t)
  const a = ABONNEMENT.test(t) || /^(le |la )?(1|premier|premiere)\b/.test(t)
  if (m && a) return 'les_deux'
  if (m) return 'messages'
  if (a || /\barret/.test(t)) return 'abonnement'
  return 'flou'
}

/** Le texte est-il une demande NETTE de ne plus recevoir nos messages (sans duree ni autre service) ? */
export function demandeNette(texte: string): boolean {
  const t = normaliser(texte)
  if (TEMPORAIRE.test(t) || AUTRE_SERVICE.test(t)) return false
  return NET.some(r => r.test(t))
}

/**
 * La decision pour un message ECRIT PAR LA PERSONNE.
 * - dernierBot : le dernier message du bot dans la conversation (pour lire la reponse a la question de doute) ;
 * - appelModele : vrai quand l'agent a lui-meme reconnu une demande (outil ne_plus_contacter) : un texte
 *   que la regle ne trouve pas net donne alors la question de doute, jamais le marqueur.
 */
export function decisionNePlusContacter(
  texte: unknown,
  o: { dernierBot?: string | null; appelModele?: boolean } = {},
): DecisionNePlusContacter {
  if (typeof texte !== 'string' || !texte.trim()) return { type: 'rien', motif: 'pas_de_demande' }
  if (texte.length > 1500) return { type: 'rien', motif: 'trop_long' }
  const t = normaliser(texte)
  const temporaire = TEMPORAIRE.test(t)
  const autre = AUTRE_SERVICE.test(t)
  // La reponse a la question de doute (posee une seule fois).
  if (estQuestionDoute(o.dernierBot)) {
    const r = reponseAuDoute(texte)
    if (r === 'messages' && !temporaire) return { type: 'poser' }
    if (r === 'les_deux' && !temporaire) return { type: 'poser_et_abonnement' }
    if (r === 'abonnement') return { type: 'abonnement' }
    // Floue : on ne repose pas la question ; une demande nette reste comprise.
    return demandeNette(texte) ? { type: 'poser' } : { type: 'rien', motif: 'reponse_floue' }
  }
  if (temporaire) return { type: 'rien', motif: 'temporaire' }
  if (autre) return o.appelModele ? { type: 'doute' } : { type: 'rien', motif: 'autre_service' }
  if (NET.some(r => r.test(t))) return { type: 'poser' }
  if (AMBIGU.test(t)) {
    // « me desabonner des messages » : net ; « me desabonner du Live Club » : l'arret habituel.
    if (MESSAGES.test(t) && !ABONNEMENT.test(t)) return { type: 'poser' }
    if (ABONNEMENT.test(t) && !MESSAGES.test(t)) return { type: 'abonnement' }
    return { type: 'doute' }
  }
  return o.appelModele ? { type: 'doute' } : { type: 'rien', motif: 'pas_de_demande' }
}

/** Le dernier message du bot dans un fil Support (role 'assistant'), ou dans l'historique de l'agent. */
export function dernierMessageDuBot(fil: unknown): string | null {
  if (!Array.isArray(fil)) return null
  for (let i = fil.length - 1; i >= 0; i--) {
    const m = fil[i] as { role?: unknown; content?: unknown } | null
    if (m && typeof m === 'object' && m.role === 'assistant' && typeof m.content === 'string') return m.content
  }
  return null
}

/** Les details de la ligne du journal (jamais le texte de la personne). */
export function detailsMarqueur(origine: 'agent' | 'non_rattache', maintenant: Date): Record<string, unknown> {
  return { origine, demande_le: maintenant.toISOString().slice(0, 10) }
}

/** Le resultat de l'outil quand rien n'est pose (le modele repond lui-meme). */
export function resultatOutilSansMarqueur(d: DecisionNePlusContacter): Record<string, unknown> {
  if (d.type === 'abonnement') {
    return { refus: "Il parle de son abonnement, pas de nos messages : rien n'est noté. Réponds à sa demande sur l'abonnement comme d'habitude (s'il veut l'arrêter : proposer_arret)." }
  }
  return { refus: "Pas une demande nette de ne plus recevoir nos messages (une durée, un autre service, ou une réponse floue) : rien n'est noté. Réponds-lui normalement, sans parler de cette possibilité." }
}

/** Le resultat de l'outil pour « les deux » : marqueur pose, puis l'arret habituel. */
export const RESULTAT_OUTIL_LES_DEUX = {
  ok: true,
  note: 'Plus de messages de notre part, sauf ce qui touche son abonnement (le serveur le lui dit).',
  consigne: "Il veut aussi arrêter son abonnement : appelle proposer_arret, sans écrire de texte.",
}

/**
 * La consigne de l'agent (SYSTEM_PROMPT_MEMBRE). Jamais de proposition : il
 * ne reconnait que ce que la personne ecrit.
 */
export const CONSIGNE_NE_PLUS_CONTACTER = `- Ne plus recevoir nos messages : quand le membre écrit lui-même qu'il ne veut plus être contacté ou ne plus recevoir nos messages (« ne m'écrivez plus », « je ne veux plus de vos promos », « arrête de me relancer »), appelle ${NOM_OUTIL_NE_PLUS_CONTACTER} sans écrire de texte : le serveur lui répond. « Me désabonner », « me désinscrire » ou « stop » sans plus de précision : appelle aussi ${NOM_OUTIL_NE_PLUS_CONTACTER}, le serveur lui demande s'il parle de son abonnement ou de nos messages. S'il répond « mon abonnement », c'est une demande d'arrêt (proposer_arret). Une durée (« pas avant lundi », « je suis en vacances ») ou un autre service que nous : ce n'est pas cette demande, réponds normalement. Ne plus recevoir nos messages ne change rien à son accès : il garde le groupe, ses outils, et tu lui réponds toujours. Tu ne proposes jamais cette possibilité, tu n'en parles pas s'il ne le demande pas, et aucun bouton ne l'offre.`
