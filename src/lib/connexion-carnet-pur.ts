// La page de retour du lien de l'email pour le Carnet du Trader (16/11/2026) :
// https://journal.aoknowledge.com/auth/carnet. La partie PURE. La page :
// src/app/auth/carnet/page.tsx.
//
// Un lien d'email ne s'ouvre pas dans une extension. Le lien des origines de
// l'extension (ORIGINES de connexion-adresse-pur.ts) revient donc ici, le jeton
// dans le fragment (#token_hash=...&type=...), ou ?code= pour le repli de
// Supabase (PKCE). La page ne vérifie PAS le jeton : elle le passe à
// l'extension par chrome.runtime.sendMessage (externally_connectable du
// manifest du Carnet, limité à journal.aoknowledge.com), et c'est le service
// worker du Carnet qui le vérifie, pour avoir SA session. La page ne connecte
// jamais le journal.
//
// Contrat du Carnet (dépôt academic-notes-extension, src/lib/connexion-lien.ts,
// commit 76b98fc) :
//   message  { type: 'carnet:connexion-lien', token_hash, otpType }
//            ou { type: 'carnet:connexion-lien', code } ;
//   réponse  { ok: true } | { ok: false, raison: 'pas-attendu' | 'expire' |
//            'trop' | 'autre-compte' | 'erreur' } ;
//   pas de réponse : extension absente, ou message refusé par sa garde.
// D'abord l'identifiant du Store, puis celui de la version locale.
//
// Aucun import : scripts/verifier-connexion-carnet.mjs le charge tel quel (Node 22).

/** Les deux identifiants du Carnet, dans l'ordre d'envoi (mêmes que EXTENSION_CARNET_* de connexion-adresse-pur.ts). */
export const EXTENSIONS_CARNET: readonly string[] = ['phajegonlmgnjkkfdooedoddnmgpheic', 'klggbgjkojkcblgodajdjhhineocchbe']

/** Le type du message attendu par le Carnet (MESSAGE_LIEN de l'extension). */
export const MESSAGE_LIEN = 'carnet:connexion-lien'

const TYPES_LIEN: readonly string[] = ['magiclink', 'signup', 'email', 'invite']

export type DemandeCarnet =
  | { t: 'jeton'; tokenHash: string; type: string | null }
  | { t: 'code'; code: string }

export type MessageCarnet =
  | { type: typeof MESSAGE_LIEN; token_hash: string; otpType?: string }
  | { type: typeof MESSAGE_LIEN; code: string }

/** Le jeton du lien (fragment), ou le code du repli (?code=) ; null : lien incomplet. Mêmes formes que la garde du Carnet. */
export function lireLienCarnet(hash: string, search: string): DemandeCarnet | null {
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const tokenHash = h.get('token_hash') ?? ''
  if (/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) {
    const type = h.get('type')
    return { t: 'jeton', tokenHash, type: type && TYPES_LIEN.includes(type) ? type : null }
  }
  const code = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('code') ?? ''
  if (/^[A-Za-z0-9_-]{8,256}$/.test(code)) return { t: 'code', code }
  return null
}

/** Le message à passer au Carnet. */
export function messageCarnet(d: DemandeCarnet): MessageCarnet {
  if (d.t === 'code') return { type: MESSAGE_LIEN, code: d.code }
  return d.type ? { type: MESSAGE_LIEN, token_hash: d.tokenHash, otpType: d.type } : { type: MESSAGE_LIEN, token_hash: d.tokenHash }
}

export type RaisonCarnet = 'pas-attendu' | 'expire' | 'trop' | 'autre-compte' | 'erreur'
const RAISONS: readonly string[] = ['pas-attendu', 'expire', 'trop', 'autre-compte', 'erreur']
export type ReponseCarnet = { ok: true } | { ok: false; raison: RaisonCarnet }

/** La réponse du Carnet, vérifiée ; null : pas de réponse utilisable (extension absente ou message refusé). */
export function lireReponseCarnet(v: unknown): ReponseCarnet | null {
  if (!v || typeof v !== 'object') return null
  const r = v as { ok?: unknown; raison?: unknown }
  if (r.ok === true) return { ok: true }
  if (r.ok === false && typeof r.raison === 'string' && RAISONS.includes(r.raison)) return { ok: false, raison: r.raison as RaisonCarnet }
  return null
}

/** Ce que la page dit au membre. */
export type IssueCarnet = 'ok' | RaisonCarnet | 'absente' | 'lent' | 'invalide'

/** Rendu par l'envoi quand le Carnet a reçu le message mais ne répond pas à temps (il vérifie peut-être encore). */
export const LENT = 'carnet:lent'

/**
 * Passe le lien au Carnet : au Store d'abord, puis à la version locale. Une
 * réponse claire arrête (le jeton a servi, ou a été essayé). « pas-attendu »
 * laisse essayer l'autre identifiant (le jeton n'a pas été touché). Le Carnet
 * lent arrête aussi : le jeton ne part pas une seconde fois. Ne jette pas.
 */
export async function transmettreAuCarnet(
  d: DemandeCarnet,
  envoyer: (id: string, message: MessageCarnet) => Promise<unknown>,
): Promise<IssueCarnet> {
  const message = messageCarnet(d)
  let repli: IssueCarnet | null = null
  for (const id of EXTENSIONS_CARNET) {
    let brut: unknown = null
    try { brut = await envoyer(id, message) } catch { brut = null }
    if (brut === LENT) return 'lent'
    const r = lireReponseCarnet(brut)
    if (!r) continue
    if (r.ok) return 'ok'
    if (r.raison !== 'pas-attendu') return r.raison
    repli = 'pas-attendu'
  }
  return repli ?? 'absente'
}

const SUPPORT = 'support@aoknowledge.com'
const OBJET_SUPPORT = "Je n'arrive pas à connecter le Carnet du Trader"
export function lienEcrisNousCarnet(): string {
  return `mailto:${SUPPORT}?subject=${encodeURIComponent(OBJET_SUPPORT)}`
}

export const TEXTES_CARNET: Record<'envoi' | IssueCarnet, { titre: string; texte: string }> = {
  envoi: {
    titre: 'Connexion du Carnet du Trader...',
    texte: 'On passe ton lien au Carnet installé dans ce navigateur.',
  },
  ok: {
    titre: "C'est bon : ton Carnet du Trader est connecté.",
    texte: 'Tu peux fermer cet onglet et revenir dans le Carnet.',
  },
  absente: {
    titre: 'Ouvre ce lien dans le navigateur du Carnet.',
    texte: "Ce lien connecte le Carnet du Trader, l'extension pour Chrome. Ce navigateur ne le trouve pas : ouvre le lien dans le navigateur où le Carnet est installé (Chrome, Brave ou Edge), ou tape dans le Carnet le code à 6 chiffres du même email.",
  },
  expire: {
    titre: 'Ce lien a expiré ou a déjà servi.',
    texte: "Seul le dernier email reçu fonctionne. Redemande un lien depuis l'écran Compte du Carnet, ou tape le code à 6 chiffres du dernier email.",
  },
  'pas-attendu': {
    titre: "Le Carnet n'attend pas ce lien.",
    texte: "Le lien a plus d'une heure, ou le Carnet est déjà connecté. Ouvre le Carnet : s'il n'est pas connecté, redemande un lien depuis son écran Compte.",
  },
  'autre-compte': {
    titre: 'Ce lien est pour un autre compte.',
    texte: "Le Carnet attendait un lien pour une autre adresse. Redemande un lien depuis le Carnet, avec l'adresse de ton compte.",
  },
  trop: {
    titre: "Trop d'essais d'affilée.",
    texte: "Attends une minute, puis rouvre le lien depuis l'email.",
  },
  erreur: {
    titre: "La connexion du Carnet n'a pas abouti.",
    texte: "Rouvre le lien de l'email dans un instant, ou tape dans le Carnet le code à 6 chiffres du même email.",
  },
  lent: {
    titre: 'Le Carnet met du temps à répondre.',
    texte: "Ouvre le Carnet : il est peut-être déjà connecté. Sinon, tape le code à 6 chiffres de l'email dans le Carnet.",
  },
  invalide: {
    titre: 'Ce lien est incomplet.',
    texte: "Rouvre le lien depuis l'email, sans le modifier, ou redemande-en un depuis l'écran Compte du Carnet.",
  },
}

export const ECRIS_NOUS_CARNET = 'Toujours bloqué ? Écris-nous'
